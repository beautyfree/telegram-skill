/**
 * Output formatting for the CLI.
 *
 * stdout: JSON only — { ok, data } or { ok, error, code }
 * stderr: warnings, debug messages
 *
 * No AsyncLocalStorage — the CLI is a single-process, single-command tool.
 */

export type ErrorCode =
  | 'UNKNOWN'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'FLOOD_WAIT'
  | 'INVALID_ARGS'
  | 'TIMEOUT'
  | 'NO_SESSION'
  | 'PEER_FLOOD';

export interface PaginationMeta {
  hasMore?: boolean;
  nextOffset?: number | string;
}

// --- Object cleanup (BigInt conversion, depth limiting) ---

/**
 * Clean an object for JSON serialization.
 *
 * - Convert BigInt values to strings
 * - Strip binary data (Buffer/Uint8Array)
 * - Limit recursion depth (max 12)
 * - Remove underscore-prefixed internal fields (except `_` itself)
 */
export function strip(obj: unknown, depth = 0): unknown {
  if (obj === undefined) return undefined;
  if (obj === null) return null;
  if (typeof obj === 'bigint') return obj.toString();
  if (typeof obj === 'number') return obj;
  if (typeof obj === 'boolean') return obj;
  if (typeof obj === 'string') return obj;
  if (Buffer.isBuffer(obj) || obj instanceof Uint8Array) return undefined;
  if (depth > 12) return undefined;
  if (Array.isArray(obj)) {
    const a = obj.map((x) => strip(x, depth + 1)).filter((x) => x !== undefined);
    // Always preserve arrays — empty means "no results", not "field absent"
    return a;
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj);
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      // Skip underscore-prefixed internal fields
      if (k.startsWith('_')) continue;
      const c = strip(v, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

// --- Output functions ---

/**
 * Sentinel error thrown by fail() after writing JSON to stdout.
 * The top-level catch in index.ts detects this to avoid duplicate output.
 */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

/** JSON replacer that converts BigInt to string (prevents JSON.stringify from throwing). */
export const bigIntReplacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

/** Write successful result to stdout. */
export function success(data: unknown, meta?: PaginationMeta): void {
  const result: Record<string, unknown> = { ok: true, data };
  if (meta) {
    if (meta.hasMore !== undefined) result.hasMore = meta.hasMore;
    if (meta.nextOffset !== undefined) result.nextOffset = meta.nextOffset;
  }
  process.stdout.write(`${JSON.stringify(result, bigIntReplacer)}\n`);
}

/** Write error to stdout and exit with code 1. */
export function fail(message: string, code: ErrorCode = 'UNKNOWN'): never {
  process.stdout.write(`${JSON.stringify({ ok: false, error: message, code })}\n`);
  throw new CliError(message);
}

/** Write a warning to stderr. */
export function warn(message: string): void {
  console.error(`[warn] ${message}`);
}

// --- Error code mapping (Telegram RPC errors → structured codes) ---

export function mapErrorCode(message: string): ErrorCode {
  // TDLib numeric error codes
  if (/\b404\b/.test(message)) return 'NOT_FOUND';
  if (/\b401\b/.test(message)) return 'UNAUTHORIZED';
  if (/\b429\b/.test(message)) return 'FLOOD_WAIT';
  // RPC error names (Telegram API)
  if (
    /MESSAGE_ID_INVALID|PEER_ID_INVALID|USERNAME_NOT_OCCUPIED|USERNAME_INVALID|CHANNEL_INVALID/i.test(
      message,
    )
  )
    return 'NOT_FOUND';
  if (
    /No user has|Chat not found|User not found|Message not found|Not Found|Chat info not found|File not found|Username is invalid|Invalid chat identifier/i.test(
      message,
    )
  )
    return 'NOT_FOUND';
  if (
    /MESSAGE_TOO_LONG|MESSAGE_EMPTY|MEDIA_INVALID|SCHEDULE_DATE_INVALID|ENTITY_BOUNDS_INVALID|Can't parse entities|reaction.*isn.t available/i.test(
      message,
    )
  )
    return 'INVALID_ARGS';
  if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|Session expired/i.test(message))
    return 'SESSION_EXPIRED';
  if (
    /FORBIDDEN|ADMIN_REQUIRED|WRITE_FORBIDDEN|USER_BANNED|Member list is inaccessible/i.test(
      message,
    )
  )
    return 'UNAUTHORIZED';
  if (/FLOOD_WAIT|FLOOD_PREMIUM_WAIT|Too Many Requests/i.test(message)) return 'FLOOD_WAIT';
  if (/timed out|TIMEOUT/i.test(message)) return 'TIMEOUT';
  if (/Expected: wait_/i.test(message)) return 'INVALID_ARGS';
  return 'UNKNOWN';
}
