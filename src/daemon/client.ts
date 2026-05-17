/**
 * Daemon client used by the CLI: connect, send one request, stream the
 * response back. Falls back gracefully: returns `null` if the daemon
 * isn't reachable so the caller can run the command in-process instead.
 *
 * Wire format is documented in protocol.ts.
 */
import { connect, Socket } from 'net';
import { randomBytes } from 'crypto';
import { existsSync } from 'fs';

import { daemonSocketPath } from './socket.js';
import type { Request, Response } from './protocol.js';

/**
 * Forward a single command to the daemon and stream its output. The
 * returned promise resolves with the daemon's exit code (0 / 1) and
 * writes each `out` frame to our own stdout in real time so streaming
 * commands like `listen` work transparently.
 *
 * Returns `null` if the daemon isn't running or refuses the connection.
 */
export function sendToDaemon(req: Omit<Request, 'id'>): Promise<number | null> {
  const path = daemonSocketPath();
  if (!existsSync(path)) return Promise.resolve(null);

  return new Promise<number | null>((resolve) => {
    let sock: Socket;
    try {
      sock = connect(path);
    } catch {
      return resolve(null);
    }

    const id = randomBytes(8).toString('hex');
    let buf = '';
    let exitCode: number | null = null;
    let connected = false;

    const fail = (code: number | null) => {
      try { sock.destroy(); } catch { /* noop */ }
      resolve(code);
    };

    sock.once('connect', () => {
      connected = true;
      sock.write(JSON.stringify({ id, ...req, env: { TELEGRAM_AGENT_HOME: process.env.TELEGRAM_AGENT_HOME } }) + '\n');
    });

    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let frame: Response;
        try {
          frame = JSON.parse(line);
        } catch {
          continue;
        }
        if (frame.id !== id) continue;
        if (frame.ok === true) {
          if (frame.out !== undefined) process.stdout.write(frame.out);
          if (frame.done) {
            exitCode = 0;
            sock.end();
          }
        } else {
          process.stderr.write(JSON.stringify({ ok: false, error: frame.error }) + '\n');
          exitCode = 1;
          sock.end();
        }
      }
    });

    sock.on('close', () => resolve(exitCode));
    sock.on('error', () => {
      // If we never got past the connect handshake the daemon isn't
      // really alive — let the caller fall back to in-process.
      fail(connected ? 1 : null);
    });
  });
}
