/**
 * Common helpers shared by every command module.
 *
 * Each command file imports `withClient`, the flag helpers, `print` / `fail`
 * / `ok` / `need`, and the serializers. Keeps the per-command files focused
 * on the actual gram.js call.
 */
import { readFileSync } from 'node:fs';

import {
  MESSAGE_FILTER,
  parsePeer,
  resolveAccountId,
  safeClient,
  safeStringify,
  serializeEntity,
  serializeMessage,
} from '../helpers.js';

export { MESSAGE_FILTER, parsePeer, safeStringify, serializeEntity, serializeMessage };

// ─── arg / flag types ────────────────────────────────────────────────

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export type Flags = ParsedArgs['flags'];

export type Cmd = (args: string[], flags: Flags) => Promise<void>;

export interface CmdGroup {
  [k: string]: Cmd | CmdGroup;
}

// ─── flag helpers ────────────────────────────────────────────────────

export function flagStr(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}

export function flagNum(flags: Flags, key: string): number | undefined {
  const v = flagStr(flags, key);
  return v === undefined ? undefined : Number(v);
}

export function flagBool(flags: Flags, key: string): boolean | undefined {
  const v = flags[key];
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  const s = v.toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

export function flagList(flags: Flags, key: string): string[] | undefined {
  const v = flagStr(flags, key);
  if (v === undefined) return undefined;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function flagNumList(flags: Flags, key: string): number[] | undefined {
  return flagList(flags, key)?.map((s) => Number(s));
}

// ─── output ──────────────────────────────────────────────────────────

export function print(value: any): void {
  process.stdout.write(`${safeStringify(value)}\n`);
}

export function ok(extra?: Record<string, any>): void {
  print({ ok: true, ...(extra ?? {}) });
}

/**
 * Emit a soft warning to stderr without exiting. Use for things the
 * caller probably wants to know about but that aren't a hard failure
 * — degraded mode, deferred work, missing optional config.
 *
 * Lines are prefixed `[warn]` and end with `\n`. Not JSON — that's
 * reserved for `fail()`. Agents that parse strictly should ignore
 * stderr unless `process.exitCode !== 0`.
 */
export function warn(message: string): void {
  process.stderr.write(`[warn] ${message}\n`);
}

/**
 * Machine-readable error category. Mirrors avemeva/agent-telegram so
 * agents can branch on `.code` instead of regex-ing message strings.
 *
 * - INVALID_ARGS: bad command, missing/invalid arguments, bad flags
 * - NOT_FOUND:    entity / message / file not found, peer doesn't exist
 * - FLOOD_WAIT:   rate-limited (long wait)
 * - PERMISSION:   action denied — not admin, banned, no rights
 * - PREMIUM:      Telegram Premium required for this feature
 * - UNKNOWN:      anything else — surface the raw error message
 */
export type ErrorCode = 'INVALID_ARGS' | 'NOT_FOUND' | 'FLOOD_WAIT' | 'PERMISSION' | 'PREMIUM' | 'UNKNOWN';

export function fail(message: string, code: ErrorCode | number = 'UNKNOWN', exitCode = 1): never {
  // Back-compat: second arg used to be an exit code (number). Keep working.
  const errorCode: ErrorCode = typeof code === 'string' ? code : 'UNKNOWN';
  process.stderr.write(`${JSON.stringify({ ok: false, error: message, code: errorCode })}\n`);
  process.exit(typeof code === 'number' ? code : exitCode);
}

/**
 * Classify a raw gram.js / MTProto error into an ErrorCode.
 * Use at every `catch (err)` boundary so the exit shape stays
 * predictable. Pattern lifted from avemeva.
 */
export function classifyError(err: unknown): ErrorCode {
  const msg = (err as Error)?.message ?? String(err);
  if (/FLOOD_WAIT/i.test(msg)) return 'FLOOD_WAIT';
  if (/PEER_ID_INVALID|USERNAME_NOT_OCCUPIED|MSG_ID_INVALID|CHANNEL_INVALID|USER_NOT_PARTICIPANT/i.test(msg))
    return 'NOT_FOUND';
  if (/PREMIUM/i.test(msg)) return 'PREMIUM';
  if (/CHAT_ADMIN_REQUIRED|CHAT_WRITE_FORBIDDEN|USER_PRIVACY_RESTRICTED|BANNED_RIGHTS|RIGHT_FORBIDDEN/i.test(msg))
    return 'PERMISSION';
  return 'UNKNOWN';
}

// ─── arg helpers ─────────────────────────────────────────────────────

export function need(args: string[], i: number, name: string): string {
  if (args[i] === undefined) fail(`Missing argument: <${name}>`, 'INVALID_ARGS');
  return args[i];
}

/** Parse one or many "id" tokens. Accepts `"1,2,3"` or `"1" "2" "3"`. */
export function collectIds(tokens: string[]): number[] {
  return tokens
    .flatMap((s) => s.split(','))
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
}

// ─── client / peer ───────────────────────────────────────────────────

export async function withClient<T>(flags: Flags, fn: (client: any, accountId: string) => Promise<T>): Promise<T> {
  const accountId = resolveAccountId(flagStr(flags, 'account'));
  const client = await safeClient(accountId);
  return fn(client, accountId);
}

export async function inputPeerOf(client: any, peer: string): Promise<any> {
  const entity = await client.getEntity(parsePeer(peer));
  return client.getInputEntity(entity);
}

// ─── serializers ─────────────────────────────────────────────────────

export function serializeDialog(d: any) {
  return {
    id: d.id?.toString(),
    name: d.name,
    title: d.title,
    unreadCount: d.unreadCount,
    date: d.date,
    pinned: d.pinned,
    archived: d.folderId !== undefined,
  };
}

// ─── text-body input (--stdin / --file / positional) ────────────────

/**
 * Resolve a message body from one of three sources, in priority order:
 *
 *   1. `--file <path>` — read the file and use its contents
 *   2. `--stdin`       — read all of stdin until EOF
 *   3. the positional argument the caller already had in hand
 *
 * Throws if none of the three are present.
 */
export async function readMessageBody(positional: string | undefined, flags: Flags): Promise<string> {
  const filePath = flagStr(flags, 'file');
  if (filePath) {
    try {
      return readFileSync(filePath, 'utf8');
    } catch (err) {
      fail(`Failed to read --file ${filePath}: ${(err as Error).message}`, 'NOT_FOUND');
    }
  }
  if (flagBool(flags, 'stdin')) {
    return new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      process.stdin.on('data', (c) => chunks.push(Buffer.from(c)));
      process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  }
  if (positional !== undefined) return positional;
  fail('No message body. Pass it as a positional argument, --stdin, or --file <path>.', 'INVALID_ARGS');
}
