/**
 * Lazy daemon spawner. Called by the CLI before falling back to
 * in-process execution: if no daemon is running, fork one and wait
 * for the socket to appear (~1-2s).
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { daemonSocketPath, isDaemonRunning } from './socket.js';

const SPAWN_WAIT_MS = 4000;

export async function spawnDaemonIfNeeded(): Promise<boolean> {
  if (await isDaemonRunning()) return true;
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = join(here, 'entry.js');
  if (!existsSync(entry)) return false;

  // Fork detached so it survives the CLI process exit. Inherit env but
  // disconnect stdio — the daemon logs to stderr via the logger module.
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: 'ignore',
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
