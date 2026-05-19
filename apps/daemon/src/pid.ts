/**
 * PID file management — write, read, clean up, detect stale daemons.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { PID_FILE, PORT_FILE } from './config';
import { log } from './logger';

/**
 * Check for a stale PID file and clean it up.
 *
 * If a running daemon is detected (process exists), this function logs
 * and exits the current process. If the PID file is stale (process is dead),
 * it removes the file so the new daemon can start.
 */
export function cleanStalePid(): void {
  if (!existsSync(PID_FILE)) return;

  try {
    const pid = Number(readFileSync(PID_FILE, 'utf-8').trim());
    if (Number.isNaN(pid) || pid <= 0) {
      // Corrupt PID file — remove it
      safeUnlink(PID_FILE);
      return;
    }

    // Check if the process is alive (signal 0 = existence check)
    process.kill(pid, 0);

    // If we get here, the process exists
    log(`Daemon already running at PID ${pid}`);
    process.exit(0);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ESRCH') {
      // Process doesn't exist — stale PID file
      safeUnlink(PID_FILE);
    } else if (err.code === 'EPERM') {
      // Process exists but we don't have permission — it's running
      log('Daemon already running (EPERM)');
      process.exit(0);
    }
    // Other errors: proceed (file might have been removed already)
  }
}

/** Write the current process PID to the PID file. */
export function writePid(): void {
  writeFileSync(PID_FILE, String(process.pid));
}

/** Write the server port to the port file. */
export function writePort(port: number): void {
  writeFileSync(PORT_FILE, String(port));
}

/** Remove PID and port files. Safe to call multiple times. */
export function cleanupFiles(): void {
  safeUnlink(PID_FILE);
  safeUnlink(PORT_FILE);
}

function safeUnlink(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Already removed or never existed
  }
}
