/**
 * `telegram-agent listen [chat...]` — stream new messages in real time,
 * one JSON object per line. Stays alive until Ctrl-C.
 *
 * Modes:
 *   listen <chat>                — single chat (positional)
 *   listen --chat a,b,c          — multi-chat (comma-separated peers)
 *   listen --type group          — all groups (no per-chat filter)
 *   listen --type user           — all 1:1 chats
 *   listen --type channel        — all channels (broadcast)
 *   listen --type bot            — all bots
 *
 * Each event is a complete JSON object, suitable for piping into
 * `jq -c` or any line-delimited consumer.
 *
 * Future: pair with the daemon so multiple `listen` invocations share a
 * single update stream instead of each opening its own socket.
 */
import { NewMessage } from 'telegram/events/index.js';

import type { Cmd } from './_shared.js';
import {
  parsePeer,
  withClient,
  serializeMessage,
  serializeEntity,
  flagBool,
  flagNum,
  flagStr,
  MESSAGE_FILTER,
} from './_shared.js';

type ChatType = 'user' | 'bot' | 'group' | 'channel' | undefined;

function classifyDialog(d: any): ChatType {
  if (!d) return undefined;
  if (d.isUser && (d.entity as any)?.bot) return 'bot';
  if (d.isUser) return 'user';
  if (d.isGroup) return 'group';
  if (d.isChannel) return 'channel';
  return undefined;
}

export const listen: Cmd = async (args, flags) => {
  const filterName = flagStr(flags, 'filter');
  const matchFilter = (m: any): boolean => {
    if (!filterName) return true;
    const ctor = (MESSAGE_FILTER as any)[filterName]?.();
    if (!ctor) return true;
    return !!m.media?.className;
  };

  // Peer set comes from three sources, in priority:
  //   1. Positional args (`listen @a @b`)
  //   2. `--chat a,b,c` flag
  //   3. `--type <user|bot|group|channel>` — broad subscription to all
  //      dialogs of that category at startup time.
  // At least one must be provided.
  const explicitPeers: string[] = [];
  for (const a of args) explicitPeers.push(a);
  const chatFlag = flagStr(flags, 'chat');
  if (chatFlag) {
    for (const p of chatFlag.split(',')) {
      const trimmed = p.trim();
      if (trimmed) explicitPeers.push(trimmed);
    }
  }
  const typeFlag = flagStr(flags, 'type') as ChatType;
  if (!explicitPeers.length && !typeFlag) {
    process.stderr.write(
      JSON.stringify({
        ok: false,
        error:
          'No subscription target. Pass `<chat>` positional, `--chat a,b,c`, or `--type user|bot|group|channel`.',
      }) + '\n',
    );
    process.exit(1);
  }

  await withClient(flags, async (client) => {
    // Resolve target chat ids — used to filter event stream so we don't
    // emit chatter from unrelated dialogs.
    const targetIds = new Set<string>();
    const peerSummaries: any[] = [];

    for (const p of explicitPeers) {
      const ent = await client.getEntity(parsePeer(p));
      const id = (ent as any)?.id?.toString?.();
      if (id) targetIds.add(id);
      peerSummaries.push(serializeEntity(ent));
    }
    if (typeFlag) {
      const dialogs = await client.getDialogs({ limit: 500 } as any);
      for (const d of dialogs) {
        if (classifyDialog(d) !== typeFlag) continue;
        const id = (d.entity as any)?.id?.toString?.();
        if (id) targetIds.add(id);
        peerSummaries.push(serializeEntity(d.entity));
      }
    }

    process.stdout.write(
      JSON.stringify({
        event: 'listen-started',
        peers: peerSummaries,
        chatCount: targetIds.size,
        type: typeFlag ?? null,
        ts: Math.floor(Date.now() / 1000),
      }) + '\n',
    );

    const since = flagNum(flags, 'since');
    const seenIds = new Set<string>();

    client.addEventHandler(async (event: any) => {
      const m = event.message;
      if (!m) return;
      // gram.js's peerId is a TL Peer object — pull a stringified id.
      const peerId =
        m.peerId?.userId?.toString?.() ??
        m.peerId?.chatId?.toString?.() ??
        m.peerId?.channelId?.toString?.();
      if (!peerId || !targetIds.has(peerId)) return;
      if (since && (m.date ?? 0) < since) return;

      // Dedupe across both single + multi-chat modes; key = chat + msgId.
      const dedupeKey = `${peerId}:${m.id}`;
      if (seenIds.has(dedupeKey)) return;
      seenIds.add(dedupeKey);

      if (!matchFilter(m)) return;
      process.stdout.write(JSON.stringify({ event: 'message', ...serializeMessage(m) }) + '\n');
    }, new NewMessage({}));

    if (flagBool(flags, 'silent') !== true) {
      // No-op; placeholder to satisfy lint about unused flags.
    }
    // Block forever — Ctrl-C terminates.
    await new Promise<void>(() => {});
  });
};
