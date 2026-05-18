/**
 * `chats` command group.
 *
 *   chats list      — your dialog list with filtering
 *   chats search    — find a dialog by name/title/username substring
 *   chats members   — list participants of a group/channel
 */
import { Api } from 'telegram';
import { enrichMemberList } from '../enrich/profiles.js';
import type { Cmd, CmdGroup } from './_shared.js';
import {
  flagBool,
  flagNum,
  flagStr,
  need,
  parsePeer,
  print,
  serializeDialog,
  serializeEntity,
  withClient,
} from './_shared.js';

/**
 * Map a high-level `--type` keyword to a predicate over a gram.js Dialog.
 * Mirrors avemeva's vocabulary: user (=private DM with a real person),
 * bot, group (regular + supergroup), channel (broadcast).
 */
function typeFilter(t: string | undefined): (d: any) => boolean {
  if (!t) return () => true;
  switch (t) {
    case 'user':
    case 'private':
    case 'chat':
      return (d) => d.isUser && !(d.entity as any)?.bot;
    case 'bot':
      return (d) => d.isUser && !!(d.entity as any)?.bot;
    case 'group':
      return (d) => d.isGroup;
    case 'channel':
      return (d) => d.isChannel && !d.isGroup;
    default:
      return () => true;
  }
}

const list: Cmd = async (_, flags) => {
  await withClient(flags, async (client) => {
    const dialogs = await client.getDialogs({
      archived: flagBool(flags, 'archived') ?? false,
      ignorePinned: flagBool(flags, 'ignore-pinned') ?? false,
      folder: flagNum(flags, 'folder'),
      limit: flagNum(flags, 'limit') ?? 50,
      offsetDate: flagNum(flags, 'offset-date'),
    } as any);
    const wantUnread = flagBool(flags, 'unread');
    const match = typeFilter(flagStr(flags, 'type'));
    const out = dialogs
      .filter((d: any) => (wantUnread ? (d.unreadCount ?? 0) > 0 : true))
      .filter(match)
      .map(serializeDialog);
    const limit = flagNum(flags, 'limit') ?? 50;
    const hasMore = out.length >= limit;
    // Cursor: oldest dialog's `date`, fed back via `--offset-date`.
    const nextOffset = out.length ? Math.min(...out.map((d: any) => d.date ?? 0)) : null;
    print({ items: out, hasMore, nextOffset });
  });
};

const search: Cmd = async (args, flags) => {
  const query = need(args, 0, 'query');
  const limit = flagNum(flags, 'limit') ?? 20;
  const match = typeFilter(flagStr(flags, 'type'));
  await withClient(flags, async (client) => {
    const matches: any[] = [];
    if (flagBool(flags, 'global')) {
      // Public Telegram search — useful for discovering channels you're
      // not in yet. Server-side, won't include your private chats. Single
      // shot — Telegram returns at most `limit` results, no pagination.
      const result: any = await client.invoke(new Api.contacts.Search({ q: query, limit }));
      for (const c of result.chats ?? []) matches.push(serializeEntity(c));
      for (const u of result.users ?? []) matches.push(serializeEntity(u));
      print({ items: matches, hasMore: false, nextOffset: null });
      return;
    }
    // Local: iterate dialogs, substring match against name/title/username.
    const q = query.toLowerCase();
    for await (const d of client.iterDialogs({
      archived: flagBool(flags, 'archived') ?? false,
    } as any)) {
      const hay = `${d.name ?? ''} ${d.title ?? ''} ${(d.entity as any)?.username ?? ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
      if (!match(d)) continue;
      matches.push(serializeDialog(d));
      if (matches.length >= limit) break;
    }
    print({ items: matches, hasMore: matches.length >= limit, nextOffset: null });
  });
};

const members: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  await withClient(flags, async (client) => {
    const opts: any = {
      limit: flagNum(flags, 'limit') ?? 100,
    };
    const q = flagStr(flags, 'query');
    if (q) opts.search = q;
    // `--type` filters participant role. gram.js supports
    // ChannelParticipantsBots / Admins / Recent via the filter param.
    const t = flagStr(flags, 'type');
    if (t === 'bot') opts.filter = new Api.ChannelParticipantsBots();
    else if (t === 'admin') opts.filter = new Api.ChannelParticipantsAdmins();
    else if (t === 'recent') opts.filter = new Api.ChannelParticipantsRecent();
    const list = await client.getParticipants(parsePeer(peer), opts);
    // Opt-in profile enrichment — each member gets a `users.GetFullUser`
    // round-trip for bio/about. Off by default because it costs N extra
    // RPCs on big groups.
    if (flagBool(flags, 'profiles')) await enrichMemberList(client, list as any[]);
    const items = list.map((e: any) => {
      const base = serializeEntity(e);
      if (e?.profile && base) (base as any).profile = e.profile;
      return base;
    });
    const limit = opts.limit;
    print({ items, hasMore: items.length >= limit, nextOffset: null });
  });
};

export const chats: CmdGroup = { list, search, members };
