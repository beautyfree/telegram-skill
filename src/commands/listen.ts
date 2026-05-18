/**
 * `telegram-agent listen [chat...]` — stream realtime events as NDJSON.
 *
 * Filters (any combination):
 *   listen <chat>...              positional include set
 *   --chat a,b,c                  same as positional, comma form
 *   --exclude-chat a,b            drop these from the include set
 *   --type user|bot|group|channel include all dialogs of that category
 *   --exclude-type same           drop the whole category
 *   --incoming                    only m.out === false (no echoes of self-sent)
 *
 * Events:
 *   --event new_message,edit_message,delete_messages,message_reactions,
 *           read_outbox,user_typing,user_status,callback_query,album
 *   Default: new_message, edit_message, delete_messages, message_reactions
 *
 * Each event is a complete JSON object with `event: '<type>'`.
 */
import { Api } from 'telegram';
// gram.js's `events/index.js` only re-exports NewMessage + Raw at
// runtime; the other event constructors live as standalone files.
// Their .d.ts is shipped — import them directly.
import { Album } from 'telegram/events/Album.js';
import { CallbackQuery } from 'telegram/events/CallbackQuery.js';
import { DeletedMessage } from 'telegram/events/DeletedMessage.js';
import { EditedMessage } from 'telegram/events/EditedMessage.js';
import { NewMessage, Raw } from 'telegram/events/index.js';
import { autoDownloadAll, autoDownloadSmall } from '../enrich/download.js';
import { flattenMessage } from '../enrich/flatten.js';
import { addSenderNames } from '../enrich/names.js';
import type { Cmd } from './_shared.js';
import { fail, flagBool, flagNum, flagStr, MESSAGE_FILTER, parsePeer, serializeEntity, withClient } from './_shared.js';

type ChatType = 'user' | 'bot' | 'group' | 'channel' | undefined;

function classifyDialog(d: any): ChatType {
  if (!d) return undefined;
  if (d.isUser && (d.entity as any)?.bot) return 'bot';
  if (d.isUser) return 'user';
  if (d.isGroup) return 'group';
  if (d.isChannel) return 'channel';
  return undefined;
}

const ALL_EVENTS = [
  'new_message',
  'edit_message',
  'delete_messages',
  'message_reactions',
  'read_outbox',
  'user_typing',
  'user_status',
  'callback_query',
  'album',
] as const;
type EventName = (typeof ALL_EVENTS)[number];

const DEFAULT_EVENTS: ReadonlySet<EventName> = new Set([
  'new_message',
  'edit_message',
  'delete_messages',
  'message_reactions',
]);

function peerIdOf(p: any): string | undefined {
  return p?.userId?.toString?.() ?? p?.chatId?.toString?.() ?? p?.channelId?.toString?.();
}

export const listen: Cmd = async (args, flags) => {
  const filterName = flagStr(flags, 'filter');
  const matchFilter = (m: any): boolean => {
    if (!filterName) return true;
    const ctor = (MESSAGE_FILTER as any)[filterName]?.();
    if (!ctor) return true;
    return !!m.media?.className;
  };

  // ── Event allowlist ──
  const wantedEvents = flagStr(flags, 'event')
    ? new Set(
        flagStr(flags, 'event')!
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean) as EventName[],
      )
    : DEFAULT_EVENTS;
  for (const e of wantedEvents) {
    if (!(ALL_EVENTS as readonly string[]).includes(e)) {
      fail(`Unknown event: ${e}. Known: ${ALL_EVENTS.join(', ')}`, 'INVALID_ARGS');
    }
  }

  // ── Peer include / exclude set ──
  const explicitPeers: string[] = [];
  for (const a of args) explicitPeers.push(a);
  const chatFlag = flagStr(flags, 'chat');
  if (chatFlag) {
    for (const p of chatFlag.split(',')) {
      const trimmed = p.trim();
      if (trimmed) explicitPeers.push(trimmed);
    }
  }
  const excludePeerArg = flagStr(flags, 'exclude-chat');
  const explicitExcludes: string[] = excludePeerArg
    ? excludePeerArg
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const typeFlag = flagStr(flags, 'type') as ChatType;
  const excludeType = flagStr(flags, 'exclude-type') as ChatType;
  const incoming = flagBool(flags, 'incoming') ?? false;
  if (!explicitPeers.length && !typeFlag) {
    fail(
      'No subscription target. Pass `<chat>` positional, `--chat a,b,c`, or `--type user|bot|group|channel`.',
      'INVALID_ARGS',
    );
  }

  await withClient(flags, async (client, accountId) => {
    // Resolve everything to ids up front. Dialog scan only happens once
    // — new chats that appear later are not auto-subscribed.
    const includeIds = new Set<string>();
    const excludeIds = new Set<string>();
    const peerSummaries: any[] = [];

    for (const p of explicitPeers) {
      const ent = await client.getEntity(parsePeer(p));
      const id = (ent as any)?.id?.toString?.();
      if (id) includeIds.add(id);
      peerSummaries.push(serializeEntity(ent));
    }
    for (const p of explicitExcludes) {
      const ent = await client.getEntity(parsePeer(p));
      const id = (ent as any)?.id?.toString?.();
      if (id) excludeIds.add(id);
    }
    if (typeFlag || excludeType) {
      const dialogs = await client.getDialogs({ limit: 500 } as any);
      for (const d of dialogs) {
        const kind = classifyDialog(d);
        const id = (d.entity as any)?.id?.toString?.();
        if (!id) continue;
        if (typeFlag && kind === typeFlag) {
          includeIds.add(id);
          peerSummaries.push(serializeEntity(d.entity));
        }
        if (excludeType && kind === excludeType) excludeIds.add(id);
      }
    }
    for (const id of excludeIds) includeIds.delete(id);

    process.stdout.write(
      `${JSON.stringify({
        event: 'listen-started',
        peers: peerSummaries,
        chatCount: includeIds.size,
        type: typeFlag ?? null,
        excludeType: excludeType ?? null,
        events: Array.from(wantedEvents),
        ts: Math.floor(Date.now() / 1000),
      })}\n`,
    );

    const since = flagNum(flags, 'since');
    const seenIds = new Set<string>();

    function inSet(id: string | undefined): boolean {
      return !!id && includeIds.has(id);
    }

    function emit(payload: Record<string, unknown>): void {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    }

    // ── new_message ──
    if (wantedEvents.has('new_message')) {
      client.addEventHandler(async (event: any) => {
        const m = event.message;
        if (!m) return;
        const peerId = peerIdOf(m.peerId);
        if (!inSet(peerId)) return;
        if (since && (m.date ?? 0) < since) return;
        if (incoming && m.out) return;
        const dedupe = `${peerId}:${m.id}`;
        if (seenIds.has(dedupe)) return;
        seenIds.add(dedupe);
        if (!matchFilter(m)) return;
        // Mirror msg list enrichment for parity — names + small media.
        try {
          await autoDownloadSmall(client, [m], accountId);
          if (flagBool(flags, 'auto-download')) await autoDownloadAll(client, [m], accountId);
          await addSenderNames(client, [m]);
        } catch {
          /* non-fatal */
        }
        emit({ event: 'new_message', ...flattenMessage(m) });
      }, new NewMessage({}));
    }

    // ── edit_message ──
    if (wantedEvents.has('edit_message')) {
      client.addEventHandler(async (event: any) => {
        const m = event.message;
        if (!m) return;
        const peerId = peerIdOf(m.peerId);
        if (!inSet(peerId)) return;
        if (incoming && m.out) return;
        try {
          await addSenderNames(client, [m]);
        } catch {
          /* non-fatal */
        }
        emit({ event: 'edit_message', ...flattenMessage(m) });
      }, new EditedMessage({}));
    }

    // ── delete_messages ──
    if (wantedEvents.has('delete_messages')) {
      client.addEventHandler((event: any) => {
        // gram.js DeletedMessage emits a list of ids; we don't always
        // know the peer here (channel deletes are scoped, peer-to-peer
        // aren't). Emit all and let the agent reconcile.
        emit({ event: 'delete_messages', ids: event.deletedIds ?? [], channelId: event.channelId?.toString?.() });
      }, new DeletedMessage({}));
    }

    // ── album ──
    if (wantedEvents.has('album')) {
      client.addEventHandler(async (event: any) => {
        const msgs = event.messages ?? [];
        if (!msgs.length) return;
        const peerId = peerIdOf(msgs[0]?.peerId);
        if (!inSet(peerId)) return;
        try {
          await autoDownloadSmall(client, msgs, accountId);
          await addSenderNames(client, msgs);
        } catch {
          /* non-fatal */
        }
        emit({ event: 'album', items: msgs.map((mm: any) => flattenMessage(mm)) });
      }, new Album({}));
    }

    // ── callback_query ──
    if (wantedEvents.has('callback_query')) {
      client.addEventHandler((event: any) => {
        emit({
          event: 'callback_query',
          queryId: event.queryId?.toString?.(),
          messageId: event.messageId,
          data: event.data ? Buffer.from(event.data).toString('utf-8') : undefined,
        });
      }, new CallbackQuery({}));
    }

    // ── raw updates: message_reactions, read_outbox, user_typing, user_status ──
    const wantsRaw =
      wantedEvents.has('message_reactions') ||
      wantedEvents.has('read_outbox') ||
      wantedEvents.has('user_typing') ||
      wantedEvents.has('user_status');
    if (wantsRaw) {
      client.addEventHandler((update: any) => {
        const cls = update?.className;

        if (wantedEvents.has('message_reactions') && cls === 'UpdateMessageReactions') {
          const peerId = peerIdOf(update.peer);
          if (!inSet(peerId)) return;
          emit({ event: 'message_reactions', peerId, messageId: update.msgId, reactions: update.reactions });
          return;
        }

        if (
          wantedEvents.has('read_outbox') &&
          (cls === 'UpdateReadHistoryOutbox' || cls === 'UpdateReadChannelOutbox')
        ) {
          const peerId = peerIdOf(update.peer) ?? update.channelId?.toString?.();
          if (!inSet(peerId)) return;
          emit({ event: 'read_outbox', peerId, maxId: update.maxId });
          return;
        }

        if (
          wantedEvents.has('user_typing') &&
          (cls === 'UpdateUserTyping' || cls === 'UpdateChatUserTyping' || cls === 'UpdateChannelUserTyping')
        ) {
          const peerId = update.userId?.toString?.() ?? update.chatId?.toString?.() ?? update.channelId?.toString?.();
          if (peerId && !includeIds.has(peerId) && !includeIds.has(update.fromId?.userId?.toString?.() ?? '')) {
            // typing events come scoped to user OR chat; let either match
          }
          emit({
            event: 'user_typing',
            chatId: peerId,
            userId: update.fromId?.userId?.toString?.() ?? update.userId?.toString?.(),
            action: update.action?.className,
          });
          return;
        }

        if (wantedEvents.has('user_status') && cls === 'UpdateUserStatus') {
          emit({
            event: 'user_status',
            userId: update.userId?.toString?.(),
            status: update.status?.className,
          });
          return;
        }
      }, new Raw({}));
    }

    void Api; // suppress unused-import on Api in some builds
    if (flagBool(flags, 'silent') !== true) {
      // placeholder — preserved so other flags don't break ergonomics
    }
    // Block forever — Ctrl-C terminates.
    await new Promise<void>(() => {});
  });
};
