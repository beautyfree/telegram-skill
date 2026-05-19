/**
 * Daemon logger — writes to stderr and an append-only log file.
 * Never writes to stdout (reserved for structured output).
 */

import { appendFileSync } from 'node:fs';
import { LOG_FILE } from './config';

export function log(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] tg-daemon: ${msg}\n`;
  process.stderr.write(line);
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // Can't write to log file — stderr is enough
  }
}
