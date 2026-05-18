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
import { ensureDownloadsDir } from '../helpers.js';

const TRUNCATE_DEFAULT = 500;

/**
 * Envelope helper. With `--paginated`, list/search commands return
 * `{ items, hasMore, nextOffset }` instead of a bare array. The cursor
 * shape is per-command — documented inline. Default stays as a plain
 * array for backward compat with existing skill scripts.
 */
function paginate<T>(
  flags: Record<string, string | boolean>,
  items: T[],
  cursor: { hasMore: boolean; nextOffset?: string | number | null },
): T[] | { items: T[]; hasMore: boolean; nextOffset: string | number | null } {
  if (!flagBool(flags, 'paginated')) return items;
  return { items, hasMore: cursor.hasMore, nextOffset: cursor.nextOffset ?? null };
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

/** Download photo/voice/sticker media inline. Skips other types. */
async function autoDownload(client: any, raw: any[], accountId: string): Promise<Record<number, string>> {
  const dir = ensureDownloadsDir();
  const out: Record<number, string> = {};
  for (const m of raw) {
    if (!m.media) continue;
    const cls = m.media.className;
    const auto =
      cls === 'MessageMediaPhoto' ||
      cls === 'MessageMediaDocument' ||
      (m.voice ?? m.sticker);
    if (!auto) continue;
    const path = join(dir, `${accountId}_${m.id}`);
    try {
      const result = await client.downloadMedia(m, { outputFile: path });
      out[m.id] = typeof result === 'string' ? result : path;
    } catch {
      /* swallow — agent gets a hint via the absence of the path */
    }
  }
  return out;
}

/** Request server-side transcription for voice / round-video notes. Premium. */
async function autoTranscribe(client: any, raw: any[]): Promise<Record<number, { text?: string; pending?: boolean }>> {
  const out: Record<number, any> = {};
  for (const m of raw) {
    const isVoice = m.voice || m.media?.document?.attributes?.some?.((a: any) => a.className === 'DocumentAttributeAudio' && a.voice);
    const isRound = m.videoNote || m.media?.document?.attributes?.some?.((a: any) => a.className === 'DocumentAttributeVideo' && a.roundMessage);
    if (!isVoice && !isRound) continue;
    try {
      const inputPeer = await client.getInputEntity(m.peerId);
      const r: any = await client.invoke(new Api.messages.TranscribeAudio({ peer: inputPeer, msgId: m.id }));
      out[m.id] = { text: r.text, pending: r.pending };
    } catch (err) {
      out[m.id] = { error: (err as Error).message };
    }
  }
  return out;
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
    let enriched: any[] = filtered.map(serializeMessage);

    const downloads = flagBool(flags, 'auto-download')
      ? await autoDownload(client, filtered, accountId)
      : null;
    const transcripts = flagBool(flags, 'auto-transcribe')
      ? await autoTranscribe(client, filtered)
      : null;
    if (downloads || transcripts) {
      enriched = enriched.map((m) => ({
        ...m,
        ...(downloads && downloads[m.id] ? { downloadPath: downloads[m.id] } : {}),
        ...(transcripts && transcripts[m.id] ? { transcription: transcripts[m.id] } : {}),
      }));
    }
    const truncated = applyTruncate(enriched, flagBool(flags, 'full') ?? false);
    const wantLimit = flagNum(flags, 'limit') ?? 50;
    // `msg list` paginates by feeding the oldest message id back as
    // `--offset-id`. hasMore is a best-effort heuristic: a full page implies
    // more might exist. A short page guarantees end-of-history.
    const hasMore = truncated.length >= wantLimit;
    const nextOffset = truncated.length ? Math.min(...truncated.map((m: any) => m.id)) : null;
    print(paginate(flags, truncated, { hasMore, nextOffset }));
  });
};

const get: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  const ids = collectIds(args.slice(1));
  if (ids.length === 0) need(args, 1, 'messageId');
  await withClient(flags, async (client) => {
    const msgs = await client.getMessages(parsePeer(peer), { ids });
    print(applyTruncate(msgs.map(serializeMessage), flagBool(flags, 'full') ?? false));
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
    }

    const downloads = flagBool(flags, 'auto-download')
      ? await autoDownload(client, rawHits, accountId)
      : null;
    const transcripts = flagBool(flags, 'auto-transcribe')
      ? await autoTranscribe(client, rawHits)
      : null;
    const context = flagNum(flags, 'context') ?? 0;

    function peerOf(m: any) {
      const id =
        m.peerId?.userId?.toString?.() ??
        m.peerId?.chatId?.toString?.() ??
        m.peerId?.channelId?.toString?.();
      const peer = id ? chats.get(id) : undefined;
      return serializeEntity(peer);
    }

    const payload: any[] = [];
    for (const m of rawHits) {
      const hit = {
        ...serializeMessage(m),
        peer: peerOf(m),
        ...(downloads && downloads[m.id] ? { downloadPath: downloads[m.id] } : {}),
        ...(transcripts && transcripts[m.id] ? { transcription: transcripts[m.id] } : {}),
      };
      if (context > 0) {
        try {
          const surround = await client.getMessages(m.peerId, {
            offsetId: m.id + context + 1,
            limit: context * 2 + 1,
          });
          payload.push({
            hit,
            context: surround.map(serializeMessage),
          });
        } catch {
          payload.push({ hit, context: [] });
        }
      } else {
        payload.push(hit);
      }
    }
    const truncated = applyTruncate(payload, flagBool(flags, 'full') ?? false);
    // Per-chat search: cursor = oldest hit id (same shape as `msg list`).
    // Global search: cursor is the opaque trio `{rate,id,peer}` — we
    // encode rate+id into a single base64 string. Consumers pass it back
    // as `--offset-cursor`. Skipped here pending a real persistence flow;
    // for now we just signal hasMore so callers know there's more.
    const hasMore = rawHits.length >= limit;
    let nextOffset: string | number | null = null;
    if (truncated.length) {
      if (chat) {
        const ids = rawHits.map((m: any) => m.id);
        nextOffset = Math.min(...ids);
      } else {
        nextOffset = null; // global cursor not yet round-tripped — see TODO above
      }
    }
    print(paginate(flags, truncated, { hasMore, nextOffset }));
  });
};

export const msg: CmdGroup = { list, get, search };
