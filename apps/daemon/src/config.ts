/**
 * Application configuration — paths, ports, environment.
 *
 * Path constants come from @tg/protocol/paths (cross-platform).
 * TDLib API credentials are loaded from environment variables or config files.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export {
  APP_DIR,
  CREDENTIALS_FILE,
  DB_DIR,
  FILES_DIR,
  LOG_FILE,
  PID_FILE,
  PORT_FILE,
} from '@tg/protocol/paths';

import { APP_DIR, CREDENTIALS_FILE } from '@tg/protocol/paths';

/** Default HTTP server port. */
export const DEFAULT_PORT = 7312;

/** Idle timeout in milliseconds (10 minutes). */
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** Command execution timeout in milliseconds (30 seconds). */
export const COMMAND_TIMEOUT_MS = 30_000;

/** TDLib API credentials. */
export interface TdlibCredentials {
  apiId: number;
  apiHash: string;
}

/**
 * Load TDLib API credentials from environment or config files.
 *
 * Search order:
 *   1. Environment variables: TG_API_ID / TG_API_HASH
 *   2. Environment variables: VITE_TG_API_ID / VITE_TG_API_HASH
 *   3. ~/.config/tg/credentials (or platform equivalent)
 *   4. App data dir .env
 *   5. .env files in known project locations (dev mode)
 */
export function loadCredentials(): TdlibCredentials {
  // Try environment variables first
  const envId = process.env.TG_API_ID ?? process.env.VITE_TG_API_ID;
  const envHash = process.env.TG_API_HASH ?? process.env.VITE_TG_API_HASH;
  if (envId && envHash) {
    const apiId = Number(envId);
    if (apiId && envHash) return { apiId, apiHash: envHash };
  }

  // Fall back to config/env files
  const candidates = [
    CREDENTIALS_FILE,
    path.join(APP_DIR, '.env'),
    path.resolve(import.meta.dir, '../../../.env'),
    path.resolve(import.meta.dir, '../../.env'),
    path.resolve(import.meta.dir, '../.env'),
  ];

  for (const envPath of candidates) {
    try {
      const text = readFileSync(envPath, 'utf-8');
      const vars: Record<string, string> = {};
      for (const line of text.split('\n')) {
        const m = line.match(/^(\w+)=(.*)$/);
        if (m?.[1] && m[2] !== undefined) vars[m[1]] = m[2];
      }
      const apiId = Number(vars.TG_API_ID ?? vars.VITE_TG_API_ID);
      const apiHash = vars.VITE_TG_API_HASH ?? vars.TG_API_HASH ?? '';
      if (apiId && apiHash) return { apiId, apiHash };
    } catch {
      // File doesn't exist or can't be read — try next
    }
  }

  throw new Error(
    'TDLib API credentials not found. Set TG_API_ID and TG_API_HASH, or run: tg auth setup',
  );
}
