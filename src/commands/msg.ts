/**
 * `msg` command group.
 *
 *   msg list <chat>     — history of one chat, with rich pagination + filters
 *   msg get <chat> <id> — fetch by id(s)
 *   msg search <query>  — cross-chat or per-chat full-text search
 *
 * Inspired by avemeva/agent-telegram's surface — same flag names, same
 * filter vocabulary. Auto-enrich flags pull media + voice transcripts
 * inline so the agent can summarize without follow-up calls.
 */
import { Api } from 'telegram';
import { join } from 'path';

import type { Cmd, CmdGroup } from './_shared.js';
import {
  parsePeer,
  withClient,
  serializeMessage,
  serializeEntity,
  MESSAGE_FILTER,
  need,
  print,
  collectIds,
  flagBool,
  flagNum,
  flagStr,
} from './_shared.js';
import { addSenderNames } from '../enrich/names.js';
import { autoDownloadSmall, autoDownloadAll } from '../enrich/download.js';
import { flattenMessages, flattenMessage } from '../enrich/flatten.js';
import { attachLinkPreviews } from '../enrich/links.js';

const TRUNCATE_DEFAULT = 500;

/**
 * Envelope shape for every list/search response:
 *   { items, hasMore, nextOffset }
 * Cursor type is per-command — documented inline at each call site.
 */
interface Page<T> {
  items: T[];
  hasMore: boolean;
  nextOffset: string | number | null;
}

function pageOf<T>(items: T[], hasMore: boolean, nextOffset: string | number | null): Page<T> {
  return { items, hasMore, nextOffset };
}

/** Truncate long message text unless --full requested. */
function applyTruncate(msgs: any[], full: boolean): any[] {
  if (full) return msgs;
  return msgs.map((m) => {
    if (typeof m.text === 'string' && m.text.length > TRUNCATE_DEFAULT) {
      return { ...m, text: m.text.slice(0, TRUNCATE_DEFAULT) + '…[truncated]', truncated: true };
    }
    return m;
  });
}


/**
 * Request server-side transcription for voice / round-video notes.
 * Mutates each eligible message in place: attaches
 * `m.transcription = { text?, pending?, error? }`. Premium-only;
 * non-Premium accounts get a clean { error } per message rather than
 * a hard failure.
 */
async function autoTranscribe(client: any, raw: any[]): Promise<void> {
  for (const m of raw) {
    const isVoice = m.voice || m.media?.document?.attributes?.some?.((a: any) => a.className === 'DocumentAttributeAudio' && a.voice);
    const isRound = m.videoNote || m.media?.document?.attributes?.some?.((a: any) => a.className === 'DocumentAttributeVideo' && a.roundMessage);
    if (!isVoice && !isRound) continue;
    try {
      const inputPeer = await client.getInputEntity(m.peerId);
      const r: any = await client.invoke(new Api.messages.TranscribeAudio({ peer: inputPeer, msgId: m.id }));
      m.transcription = { text: r.text, pending: r.pending };
    } catch (err) {
      m.transcription = { error: (err as Error).message };
    }
  }
}

const list: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  await withClient(flags, async (client, accountId) => {
    const opts: any = {
      limit: flagNum(flags, 'limit') ?? 50,
      reverse: flagBool(flags, 'reverse') ?? false,
    };
    const q = flagStr(flags, 'query');
    if (q) opts.search = q;
    const filter = flagStr(flags, 'filter');
    if (filter) opts.filter = (MESSAGE_FILTER as any)[filter]?.() ?? undefined;
    const from = flagStr(flags, 'from');
    if (from) opts.fromUser = parsePeer(from);
    const offsetId = flagNum(flags, 'offset-id');
    if (offsetId) opts.offsetId = offsetId;
    const minId = flagNum(flags, 'min-id');
    if (minId) opts.minId = minId;
    // --since takes a unix timestamp and means "newer than this date".
    // gram.js's offsetDate is "older than", so we filter client-side too.
    const since = flagNum(flags, 'since');

    const raw = await client.getMessages(parsePeer(peer), opts);
    const filtered = since ? raw.filter((m: any) => (m.date ?? 0) >= since) : raw;
    // Enrichment pipeline mirrors avemeva: download tiny media → names → transcribe → flatten.
    await autoDownloadSmall(client, filtered, accountId);
    if (flagBool(flags, 'auto-download')) await autoDownloadAll(client, filtered, accountId);
    await addSenderNames(client, filtered);
    if (flagBool(flags, 'auto-transcribe')) await autoTranscribe(client, filtered);
    if (flagBool(flags, 'preview-links')) await attachLinkPreviews(client, filtered);
    const enriched = flattenMessages(filtered);
    const truncated = applyTruncate(enriched, flagBool(flags, 'full') ?? false);
    const wantLimit = flagNum(flags, 'limit') ?? 50;
    // `msg list` paginates by feeding the oldest message id back as
    // `--offset-id`. hasMore is a best-effort heuristic: a full page implies
    // more might exist. A short page guarantees end-of-history.
    const hasMore = truncated.length >= wantLimit;
    const nextOffset = truncated.length ? Math.min(...truncated.map((m: any) => m.id)) : null;
    print(pageOf(truncated, hasMore, nextOffset));
  });
};

const get: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  const ids = collectIds(args.slice(1));
  if (ids.length === 0) need(args, 1, 'messageId');
  await withClient(flags, async (client, accountId) => {
    const msgs = await client.getMessages(parsePeer(peer), { ids });
    await autoDownloadSmall(client, msgs, accountId);
    if (flagBool(flags, 'auto-download')) await autoDownloadAll(client, msgs, accountId);
    await addSenderNames(client, msgs);
    if (flagBool(flags, 'auto-transcribe')) await autoTranscribe(client, msgs);
    if (flagBool(flags, 'preview-links')) await attachLinkPreviews(client, msgs);
    const items = applyTruncate(flattenMessages(msgs), flagBool(flags, 'full') ?? false);
    // `msg get` is single-shot — no pagination, but we keep the envelope
    // shape so every list/search/get response is the same shape.
    print(pageOf(items, false, null));
  });
};

/**
 * Cross-chat search. Use `--chat <peer>` to narrow to one dialog.
 * `--context N` returns N messages before + the hit + N after, as
 * `{ hit, context: [...] }` rows.
 */
const search: Cmd = async (args, flags) => {
  const query = need(args, 0, 'query');
  await withClient(flags, async (client, accountId) => {
    const filterName = flagStr(flags, 'filter');
    const filterCtor = filterName
      ? (MESSAGE_FILTER as any)[filterName]?.() ?? new Api.InputMessagesFilterEmpty()
      : new Api.InputMessagesFilterEmpty();
    const limit = flagNum(flags, 'limit') ?? 50;
    const minDate = flagNum(flags, 'since') ?? 0;
    const maxDate = flagNum(flags, 'until') ?? 0;
    const chat = flagStr(flags, 'chat');

    let rawHits: any[] = [];
    let chats = new Map<string, any>();

    if (chat) {
      // Per-chat search — supports --from filter, same as `msg list --query`.
      const opts: any = { search: query, limit, filter: filterCtor };
      const from = flagStr(flags, 'from');
      if (from) opts.fromUser = parsePeer(from);
      rawHits = await client.getMessages(parsePeer(chat), opts);
      await addSenderNames(client, rawHits);
    } else {
      const result: any = await client.invoke(
        new Api.messages.SearchGlobal({
          q: query,
          filter: filterCtor,
          minDate,
          maxDate,
          offsetRate: 0,
          offsetPeer: new Api.InputPeerEmpty(),
          offsetId: 0,
          limit,
        })
      );
      rawHits = result.messages ?? [];
      for (const c of result.chats ?? []) chats.set(c.id?.toString(), c);
      for (const u of result.users ?? []) chats.set(u.id?.toString(), u);
      await addSenderNames(client, rawHits);
    }

    await autoDownloadSmall(client, rawHits, accountId);
    if (flagBool(flags, 'auto-download')) await autoDownloadAll(client, rawHits, accountId);
    if (flagBool(flags, 'auto-transcribe')) await autoTranscribe(client, rawHits);
    if (flagBool(flags, 'preview-links')) await attachLinkPreviews(client, rawHits);
    const context = flagNum(flags, 'context') ?? 0;

    function peerOf(m: any): any {
      const id =
        m.peerId?.userId?.toString?.() ??
        m.peerId?.chatId?.toString?.() ??
        m.peerId?.channelId?.toString?.();
      const raw = id ? chats.get(id) : undefined;
      if (!raw) return undefined;
      const type: 'user' | 'chat' | 'channel' = m.peerId?.userId
        ? 'user'
        : m.peerId?.chatId
          ? 'chat'
          : 'channel';
      return {
        id,
        type,
        name: raw.title ?? [raw.firstName, raw.lastName].filter(Boolean).join(' ') ?? undefined,
        username: raw.username ?? undefined,
      };
    }

    const payload: any[] = [];
    for (const m of rawHits) {
      // For global search, attach `peer` from the inline chat map if
      // names enrichment didn't already do it.
      if (!m.peer) {
        const fallbackPeer = peerOf(m);
        if (fallbackPeer) m.peer = fallbackPeer;
      }
      const hit = flattenMessage(m);
      if (context > 0) {
        try {
          const surround = await client.getMessages(m.peerId, {
            offsetId: m.id + context + 1,
            limit: context * 2 + 1,
          });
          await addSenderNames(client, surround);
          payload.push({
            hit,
            context: flattenMessages(surround),
          });
        } catch {
          payload.push({ hit, context: [] });
        }
      } else {
        payload.push(hit);
      }
    }
    const truncated = applyTruncate(payload, flagBool(flags, 'full') ?? false);
    // Per-chat: cursor = oldest hit id, fed back via `--offset-id`.
    // Global: SearchGlobal cursor is the trio (rate, id, peer); for now we
    // signal hasMore but leave nextOffset null. Global pagination roadmap
    // is to base64-encode the trio and accept it back via `--offset-cursor`.
    const hasMore = rawHits.length >= limit;
    let nextOffset: string | number | null = null;
    if (truncated.length && chat) {
      nextOffset = Math.min(...rawHits.map((m: any) => m.id));
    }
    print(pageOf(truncated, hasMore, nextOffset));
  });
};

export const msg: CmdGroup = { list, get, search };
