/**
 * Shared daemon socket path + liveness probe.
 *
 * Both the daemon server and every CLI invocation need to agree on where
 * the IPC socket lives. We put it under the same shared session-store
 * directory so it tracks `TELEGRAM_AGENT_HOME` overrides.
 */
import { connect } from 'net';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

/** Resolve `<TELEGRAM_AGENT_HOME>/daemon.sock`. */
export function daemonSocketPath(): string {
  const envHome = process.env.TELEGRAM_AGENT_HOME;
  const base = envHome ?? join(homedir(), '.telegram-agent');
  return join(base, 'daemon.sock');
}

/** Probe the socket: returns true if a daemon answers on it. */
export async function isDaemonRunning(): Promise<boolean> {
  const path = daemonSocketPath();
  if (!existsSync(path)) return false;
  return new Promise<boolean>((resolve) => {
    const sock = connect(path);
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 250);
    sock.once('connect', () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/** Ensure the parent dir exists (some callers create it lazily). */
export function socketParent(): string {
  return dirname(daemonSocketPath());
}
