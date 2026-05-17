/**
 * `telegram-agent info <peer>` — universal entity resolver.
 *
 * Accepts the same peer forms as everything else (`@username`, numeric id,
 * `me`, t.me link, phone number with `+`) and returns:
 *   { entity, dialog?, photoUrl? }
 *
 * `entity`  — serialized profile / chat / channel record
 * `dialog`  — if you have a conversation with this peer, the dialog row
 *             (unreadCount, lastDate, pinned, …). Absent otherwise.
 *
 * This replaces the older flat `resolve` command, which is kept as an
 * alias for backward compat.
 */
import type { Cmd } from './_shared.js';
import { parsePeer, withClient, serializeEntity, serializeDialog, need, print } from './_shared.js';

function normalizePeerToken(raw: string): string {
  let t = raw.trim();
  // t.me / telegram.me link → strip to the username/phone/joinHash.
  // Examples handled:
  //   https://t.me/durov           → @durov
  //   t.me/+79991234567            → +79991234567 (phone)
  //   https://t.me/joinchat/<hash> → joinchat/<hash> (let gramjs resolve)
  const m = /(?:https?:\/\/)?(?:t|telegram)\.me\/(.+)$/i.exec(t);
  if (m) t = m[1];
  // Phone: leave the leading `+` intact so it's not parsed as a peer id.
  return t;
}

export const info: Cmd = async (args, flags) => {
  const raw = need(args, 0, 'peer');
  const peer = normalizePeerToken(raw);
  await withClient(flags, async (client) => {
    const entity = await client.getEntity(parsePeer(peer));
    let dialog: any = null;
    // Best-effort: find the dialog row for this peer if one exists.
    try {
      for await (const d of client.iterDialogs({})) {
        if (d.id?.toString() === entity.id?.toString()) {
          dialog = serializeDialog(d);
          break;
        }
      }
    } catch {
      /* no dialog → ignore */
    }
    print({ entity: serializeEntity(entity), dialog });
  });
};
