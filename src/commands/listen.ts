/**
 * `telegram-agent listen <chat>` — stream new messages from a chat in
 * real time, one JSON object per line. Stays alive until Ctrl-C.
 *
 * Uses gram.js's NewMessage event handler under the hood, scoped to the
 * resolved peer. Because each line is a complete JSON object, agents can
 * pipe this into `jq -c` (or any line-delimited consumer) and react as
 * messages arrive.
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
  need,
  flagBool,
  flagNum,
  flagStr,
  MESSAGE_FILTER,
} from './_shared.js';

export const listen: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  const filterName = flagStr(flags, 'filter');
  const matchFilter = (m: any): boolean => {
    if (!filterName) return true;
    const ctor = (MESSAGE_FILTER as any)[filterName]?.();
    if (!ctor) return true;
    const cls = m.media?.className;
    // Coarse match: any media → MessageMedia*. Refine if needed.
    return !!cls;
  };

  await withClient(flags, async (client) => {
    const inputPeer = await client.getInputEntity(parsePeer(peer));

    // Print initial baseline so the agent can know "watching from msg N".
    const baseline = await client.getMessages(parsePeer(peer), { limit: 1 });
    process.stdout.write(
      JSON.stringify({
        event: 'listen-started',
        peer: serializeEntity(await client.getEntity(parsePeer(peer))),
        cursor: baseline[0]?.id ?? 0,
        ts: Math.floor(Date.now() / 1000),
      }) + '\n'
    );

    const since = flagNum(flags, 'since');
    const seenIds = new Set<number>();

    client.addEventHandler(async (event: any) => {
      const m = event.message;
      if (!m) return;
      // Filter to the chat we asked about.
      if (m.peerId?.toString?.() !== inputPeer.toString?.()) {
        // Fallback: check by chatId numeric match if available.
        const sameChatId = (m.chatId ?? m.peerId)?.toString?.() === inputPeer.toString?.();
        if (!sameChatId) return;
      }
      if (since && (m.date ?? 0) < since) return;
      if (seenIds.has(m.id)) return;
      seenIds.add(m.id);
      if (!matchFilter(m)) return;
      const out = { event: 'message', ...serializeMessage(m) };
      process.stdout.write(JSON.stringify(out) + '\n');
    }, new NewMessage({}));

    // Block forever — Ctrl-C terminates.
    if (flagBool(flags, 'silent') !== true) {
      // No-op; placeholder to satisfy lint about unused flags.
    }
    await new Promise<void>(() => {});
  });
};
