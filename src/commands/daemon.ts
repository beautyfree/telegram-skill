/**
 * `telegram-agent daemon` — control the long-running gram.js daemon
 * that backs every other command for fast subsequent calls.
 *
 *   daemon start   — fork the daemon if it isn't running yet
 *   daemon stop    — terminate the running daemon
 *   daemon status  — JSON: { running, pid?, socket, idleAfter }
 */
import { existsSync, readFileSync, unlinkSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join, dirname } from 'path';

import type { Cmd, CmdGroup } from './_shared.js';
import { print, ok, fail, flagNum, flagBool } from './_shared.js';
import { daemonSocketPath, isDaemonRunning } from '../daemon/socket.js';
import { spawnDaemonIfNeeded, daemonLogPath } from '../daemon/spawn.js';
import { DAEMON_IDLE_MS } from '../daemon/protocol.js';

const pidFilePath = (): string => join(dirname(daemonSocketPath()), 'daemon.pid');

const start: Cmd = async () => {
  if (await isDaemonRunning()) {
    ok({ running: true, socket: daemonSocketPath() });
    return;
  }
  const launched = await spawnDaemonIfNeeded();
  if (!launched) fail('Failed to spawn daemon — entry.js missing or socket never came up.');
  ok({ running: true, socket: daemonSocketPath() });
};

const stop: Cmd = async () => {
  const pidFile = pidFilePath();
  if (!existsSync(pidFile)) {
    ok({ running: false });
    return;
  }
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    // pid may already be dead — clean up stale state and move on.
    try { unlinkSync(pidFile); } catch { /* noop */ }
    try { unlinkSync(daemonSocketPath()); } catch { /* noop */ }
    fail(`pid ${pid} not running: ${(err as Error).message}`);
  }
  ok({ stopped: pid });
};

const status: Cmd = async () => {
  const running = await isDaemonRunning();
  const sock = daemonSocketPath();
  let pid: number | null = null;
  const pidFile = pidFilePath();
  if (existsSync(pidFile)) {
    pid = Number(readFileSync(pidFile, 'utf8').trim());
  }
  print({
    ok: true,
    running,
    pid,
    socket: sock,
    idleTimeoutMs: DAEMON_IDLE_MS,
  });
};

/**
 * `daemon log [--lines N] [--json]` — tail the daemon's stderr log.
 *
 * Default: last 200 lines as plain text on stdout.
 * `--json`: emit a single JSON object `{ path, lines: [...] }` for
 *           machine consumption.
 */
const log: Cmd = async (_, flags) => {
  const path = daemonLogPath();
  if (!existsSync(path)) {
    if (flagBool(flags, 'json')) {
      print({ ok: true, path, lines: [] });
    } else {
      process.stderr.write(`(no log file yet at ${path})\n`);
    }
    return;
  }
  const lines = flagNum(flags, 'lines') ?? 200;
  const stat = statSync(path);
  const READ_MAX = 1024 * 1024; // 1 MB
  const offset = Math.max(0, stat.size - READ_MAX);
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(stat.size - offset);
  readSync(fd, buf, 0, buf.length, offset);
  closeSync(fd);
  const all = buf.toString('utf-8').split('\n');
  const tail = all.slice(-1 - lines).filter((s) => s.length > 0);
  if (flagBool(flags, 'json')) {
    print({ ok: true, path, lines: tail });
  } else {
    for (const l of tail) process.stdout.write(l + '\n');
  }
};

export const daemon: CmdGroup = { start, stop, status, log };
