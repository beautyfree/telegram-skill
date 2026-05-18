/**
 * Resolve user / chat / channel ids to display names, with an in-process
 * cache. Used to turn `fromId: "12345"` into `from: "Boris"` on the way
 * out of `msg list` / `msg get` / `msg search` / `listen`. Same pattern
 * as avemeva/agent-telegram's enrich/names.
 *
 * Cache lives for the duration of the CLI process — daemon-backed calls
 * implicitly share it across requests, ad-hoc calls bear the lookup cost
 * once per process.
 */
import { Api } from 'telegram';

type Client = any;

interface Cache {
  /** id → human-readable name. Keys: `user:<id>` / `chat:<id>` / `channel:<id>`. */
  byId: Map<string, string>;
  /** id → @username (lowercased). Same key shape. */
  usernameById: Map<string, string>;
}

function makeCache(): Cache {
  return { byId: new Map(), usernameById: new Map() };
}

function userKey(id: string | number | bigint | undefined): string | undefined {
  return id == null ? undefined : `user:${id}`;
}
function chatKey(id: string | number | bigint | undefined): string | undefined {
  return id == null ? undefined : `chat:${id}`;
}
function channelKey(id: string | number | bigint | undefined): string | undefined {
  return id == null ? undefined : `channel:${id}`;
}

function fullUserName(u: any): string {
  return [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.username || u?.phone || '';
}

async function fetchUser(client: Client, cache: Cache, id: string): Promise<string | undefined> {
  const key = userKey(id);
  if (!key) return undefined;
  if (cache.byId.has(key)) return cache.byId.get(key);
  try {
    // Best-effort — failure here is non-fatal, we just leave the name empty.
    const ent = await client.getEntity(BigInt(id));
    const name = fullUserName(ent);
    cache.byId.set(key, name);
    if ((ent as any)?.username) cache.usernameById.set(key, (ent as any).username);
    return name;
  } catch {
    return undefined;
  }
}

async function fetchChatLike(client: Client, cache: Cache, id: string, asChannel: boolean): Promise<string | undefined> {
  const key = asChannel ? channelKey(id) : chatKey(id);
  if (!key) return undefined;
  if (cache.byId.has(key)) return cache.byId.get(key);
  try {
    // Channels carry the `-100` prefix in client-facing land. gram.js's
    // resolveEntity handles either form, so we just pass the raw id.
    const ent = await client.getEntity(asChannel ? BigInt(`-100${id}`) : BigInt(`-${id}`));
    const name = (ent as any)?.title || '';
    cache.byId.set(key, name);
    if ((ent as any)?.username) cache.usernameById.set(key, (ent as any).username);
    return name;
  } catch {
    return undefined;
  }
}

/**
 * Walk an array of gram.js Message objects, fetch identities for every
 * unique `fromId` / `peerId`, attach `from` and `peer` fields with a
 * stable shape: `{ id, type: 'user'|'chat'|'channel', name, username? }`.
 *
 * Mutates the messages in place. Returns the same array for chaining.
 * If `cache` is omitted, a fresh per-call cache is used.
 */
export async function addSenderNames<T extends any[]>(
  client: Client,
  messages: T,
  cache: Cache = makeCache(),
): Promise<T> {
  // First pass — collect ids to resolve.
  const userIds = new Set<string>();
  const chatIds = new Set<string>();
  const channelIds = new Set<string>();

  for (const m of messages) {
    const peer = m?.peerId;
    if (peer?.userId) userIds.add(peer.userId.toString());
    if (peer?.chatId) chatIds.add(peer.chatId.toString());
    if (peer?.channelId) channelIds.add(peer.channelId.toString());

    const from = m?.fromId;
    if (from?.userId) userIds.add(from.userId.toString());
    if (from?.chatId) chatIds.add(from.chatId.toString());
    if (from?.channelId) channelIds.add(from.channelId.toString());
  }

  // Parallel fetch — gram.js batches entity lookups internally.
  await Promise.all([
    ...Array.from(userIds).map((id) => fetchUser(client, cache, id)),
    ...Array.from(chatIds).map((id) => fetchChatLike(client, cache, id, false)),
    ...Array.from(channelIds).map((id) => fetchChatLike(client, cache, id, true)),
  ]);

  // Second pass — attach.
  for (const m of messages) {
    const peer = m?.peerId;
    if (peer) {
      const id =
        peer.userId?.toString() ?? peer.chatId?.toString() ?? peer.channelId?.toString();
      const key = peer.userId
        ? userKey(peer.userId.toString())
        : peer.chatId
          ? chatKey(peer.chatId.toString())
          : channelKey(peer.channelId?.toString());
      const type = peer.userId ? 'user' : peer.chatId ? 'chat' : 'channel';
      if (id && key) {
        m.peer = {
          id,
          type,
          name: cache.byId.get(key) ?? undefined,
          username: cache.usernameById.get(key) ?? undefined,
        };
      }
    }

    const from = m?.fromId;
    if (from) {
      const id =
        from.userId?.toString() ?? from.chatId?.toString() ?? from.channelId?.toString();
      const key = from.userId
        ? userKey(from.userId.toString())
        : from.chatId
          ? chatKey(from.chatId.toString())
          : channelKey(from.channelId?.toString());
      const type = from.userId ? 'user' : from.chatId ? 'chat' : 'channel';
      if (id && key) {
        m.from = {
          id,
          type,
          name: cache.byId.get(key) ?? undefined,
          username: cache.usernameById.get(key) ?? undefined,
        };
      }
    }
  }

  return messages;
}

export { makeCache };
export type { Cache as NameCache };
