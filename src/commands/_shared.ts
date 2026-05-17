/**
 * Common helpers shared by every command module.
 *
 * Each command file imports `withClient`, the flag helpers, `print` / `fail`
 * / `ok` / `need`, and the serializers. Keeps the per-command files focused
 * on the actual gram.js call.
 */
import { readFileSync } from 'fs';

import {
  parsePeer,
  resolveAccountId,
  safeClient,
  serializeMessage,
  serializeEntity,
  safeStringify,
  MESSAGE_FILTER,
} from '../helpers.js';

export { parsePeer, serializeMessage, serializeEntity, safeStringify, MESSAGE_FILTER };

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
  process.stdout.write(safeStringify(value) + '\n');
}

export function ok(extra?: Record<string, any>): void {
  print({ ok: true, ...(extra ?? {}) });
}

export function fail(message: string, code = 1): never {
  process.stderr.write(JSON.stringify({ ok: false, error: message }) + '\n');
  process.exit(code);
}

// ─── arg helpers ─────────────────────────────────────────────────────

export function need(args: string[], i: number, name: string): string {
  if (args[i] === undefined) fail(`Missing argument: <${name}>`);
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

export async function withClient<T>(
  flags: Flags,
  fn: (client: any, accountId: string) => Promise<T>
): Promise<T> {
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
      fail(`Failed to read --file ${filePath}: ${(err as Error).message}`);
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
  fail('No message body. Pass it as a positional argument, --stdin, or --file <path>.');
}
