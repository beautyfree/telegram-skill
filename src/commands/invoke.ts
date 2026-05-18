/**
 * `telegram-agent invoke <Namespace.Class> --params '{...}'` — escape
 * hatch for any MTProto method we don't surface as a first-class
 * command. Auto-hydrates entity-like params (`peer`, `channel`, `user`,
 * `bot`, `chat`, `fromPeer`, `toPeer`).
 *
 * Destructive constructors (anything matching DESTRUCTIVE_PATTERNS)
 * require `--confirm` to run. The CLI is invoked by agents that read
 * user-generated content from Telegram — the confirm gate makes it
 * harder for a prompt-injection to slip a `channels.DeleteMessages` or
 * `messages.DeleteHistory` past the operator.
 */
import type { Cmd } from './_shared.js';
import { withClient, need, print, fail, flagStr, flagBool } from './_shared.js';
import { resolveApiClass, hydrateApiParams } from '../helpers.js';

/**
 * Substring patterns matched (case-insensitive) against the dotted class
 * name. Anything here demands an explicit `--confirm`.
 *
 * Patterns rather than exact names so future additions in gram.js's TL
 * schema (e.g. `channels.DeleteParticipantHistory`) get blocked by the
 * existing `delete` rule without us tracking every variant.
 */
const DESTRUCTIVE_PATTERNS: readonly string[] = [
  'delete',
  'kick',
  'ban',
  'restrict',
  'edit.*banned',  // channels.EditBanned, channels.EditChatBanned, ...
  'edit.*admin',   // channels.EditAdmin, messages.EditChatAdmin, ...
  'promote',       // privilege change
  'demote',        // privilege change
  'leave',
  'logout',
  'terminat',      // sessions.TerminateSession / TerminateAllSessions
  'reportspam',
  'updateusername', // identity change
  'updateprofile',  // identity change
  'updateemail',
  'changeauthorization',
  'resetauthorization',
  'wipe',
  'clearhistory',
  'destroy',
];

export function isDestructive(className: string): boolean {
  const lower = className.toLowerCase();
  return DESTRUCTIVE_PATTERNS.some((p) => new RegExp(p).test(lower));
}

export const invoke: Cmd = async (args, flags) => {
  const className = need(args, 0, 'Namespace.Class');
  const raw = flagStr(flags, 'params') ?? '{}';
  let params: any;
  try {
    params = JSON.parse(raw);
  } catch (err) {
    fail(`Invalid --params JSON: ${(err as Error).message}`, 'INVALID_ARGS');
  }

  if (isDestructive(className) && !flagBool(flags, 'confirm')) {
    fail(
      `${className} matches a destructive MTProto pattern (delete/kick/ban/promote/etc.). ` +
      `Re-run with --confirm if you really mean it. ` +
      `This guard exists because untrusted message content can reach the agent loop — ` +
      `the confirm flag forces an out-of-band intent signal from you.`,
      'PERMISSION',
    );
  }

  await withClient(flags, async (client) => {
    const Ctor: any = resolveApiClass(className);
    const hydrated = await hydrateApiParams(client, params);
    const inst = new Ctor(hydrated);
    const result = await client.invoke(inst);
    print(result);
  });
};
