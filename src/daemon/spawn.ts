/**
 * Lazy daemon spawner. Called by the CLI before falling back to
 * in-process execution: if no daemon is running, fork one and wait
 * for the socket to appear (~1-2s).
 */
import { spawn } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { daemonSocketPath, isDaemonRunning } from './socket.js';

const SPAWN_WAIT_MS = 4000;

export function daemonLogPath(): string {
  return join(dirname(daemonSocketPath()), 'daemon.log');
}

export async function spawnDaemonIfNeeded(): Promise<boolean> {
  if (await isDaemonRunning()) return true;
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = join(here, 'entry.js');
  if (!existsSync(entry)) return false;

  // Fork detached so it survives the CLI process exit. Inherit env;
  // redirect daemon stderr (where logger writes) into a rolling
  // daemon.log next to the socket. `daemon log` tails this file.
  const logFd = openSync(daemonLogPath(), 'a');
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();

  // Poll for socket readiness.
  const deadline = Date.now() + SPAWN_WAIT_MS;
  while (Date.now() < deadline) {
    if (await isDaemonRunning()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
