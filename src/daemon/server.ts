/**
 * Long-running daemon process that owns the gram.js client(s) and
 * dispatches CLI commands without re-doing the MTProto handshake every
 * call. Listens on a Unix socket at TELEGRAM_AGENT_HOME/daemon.sock.
 *
 * Started lazily by the CLI (see ./spawn.ts) and exits itself after
 * DAEMON_IDLE_MS without any connections. State (sessions, etc) is the
 * same on-disk store the in-process path uses, so swapping between the
 * two transports is transparent.
 */
import { createServer, Socket } from 'net';
import { unlinkSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { daemonSocketPath } from './socket.js';
import { DAEMON_IDLE_MS, type Request } from './protocol.js';
import { logger } from '../logger.js';
import { commandTable } from '../commands/index.js';
import type { Cmd, CmdGroup } from '../commands/_shared.js';

const PID_FILE = (() => {
  const dir = dirname(daemonSocketPath());
  return join(dir, 'daemon.pid');
})();

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function resolveMethod(method: string): Cmd | null {
  const parts = method.split('.');
  let cur: any = commandTable as any;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
    else return null;
  }
  return typeof cur === 'function' ? (cur as Cmd) : null;
}

interface FrameSink {
  out(s: string): void;
  done(): void;
  fail(message: string): void;
}

/**
 * Override stdout/stderr for the duration of one in-daemon command, so
 * its `print()` / `process.stdout.write` calls get marshalled into wire
 * frames instead of leaking onto the daemon's actual stdout.
 */
async function runCommand(req: Request, sink: FrameSink): Promise<void> {
  const cmd = resolveMethod(req.method);
  if (!cmd) {
    sink.fail(`Unknown method: ${req.method}`);
    return;
  }
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let captured = '';
  let failed = false;

  (process.stdout as any).write = (chunk: any, ..._rest: any[]) => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    sink.out(s);
    captured += s;
    return true;
  };
  (process.stderr as any).write = (chunk: any, ..._rest: any[]) => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    // stderr lines from commands are "errors" — bubble them up as fail.
    // But the helper logger also writes here; keep it real.
    try {
      const parsed = JSON.parse(s.trim());
      if (parsed && parsed.ok === false) {
        sink.fail(parsed.error ?? 'unknown');
        failed = true;
        return true;
      }
    } catch { /* not a structured error frame */ }
    realErr(s);
    return true;
  };

  try {
    await cmd(req.args, req.flags);
    if (!failed) sink.done();
  } catch (err) {
    sink.fail((err as Error).message ?? String(err));
  } finally {
    (process.stdout as any).write = realOut;
    (process.stderr as any).write = realErr;
    void captured;
  }
}

/**
 * Boot the server, write a pid file, and exit when idle.
 */
export async function startDaemon(): Promise<void> {
  const path = daemonSocketPath();
  ensureDir(dirname(path));

  // Stale socket from a crashed daemon? Remove and continue.
  if (existsSync(path)) {
    try { unlinkSync(path); } catch { /* noop */ }
  }

  let active = 0;
  let idleTimer: NodeJS.Timeout | null = null;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (active > 0) return;
    idleTimer = setTimeout(() => {
      logger.info(`daemon idle for ${DAEMON_IDLE_MS}ms, exiting`);
      try { unlinkSync(path); } catch { /* noop */ }
      try { unlinkSync(PID_FILE); } catch { /* noop */ }
      process.exit(0);
    }, DAEMON_IDLE_MS);
  };

  const server = createServer((sock: Socket) => {
    active++;
    if (idleTimer) clearTimeout(idleTimer);
    let buf = '';
    sock.on('data', async (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let req: Request;
        try { req = JSON.parse(line); } catch { continue; }

        const id = req.id;
        // Hydrate the daemon's env from the client's request so per-call
        // TELEGRAM_AGENT_HOME overrides actually take effect.
        if (req.env) {
          for (const [k, v] of Object.entries(req.env)) {
            if (v !== undefined) process.env[k] = v;
          }
        }

        const sink: FrameSink = {
          out(s: string) {
            sock.write(JSON.stringify({ id, ok: true, out: s }) + '\n');
          },
          done() {
            sock.write(JSON.stringify({ id, ok: true, done: true }) + '\n');
          },
          fail(message: string) {
            sock.write(JSON.stringify({ id, ok: false, error: message, done: true }) + '\n');
          },
        };

        await runCommand(req, sink);
      }
    });
    sock.on('close', () => {
      active--;
      if (active === 0) armIdle();
    });
    sock.on('error', () => { /* ignore */ });
  });

  server.listen(path, () => {
    writeFileSync(PID_FILE, String(process.pid));
    logger.info(`telegram-agent daemon listening on ${path} (pid ${process.pid})`);
    armIdle();
  });

  // Graceful shutdown on SIGTERM/SIGINT.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig as any, () => {
      try { server.close(); } catch { /* noop */ }
      try { unlinkSync(path); } catch { /* noop */ }
      try { unlinkSync(PID_FILE); } catch { /* noop */ }
      process.exit(0);
    });
  }
}
