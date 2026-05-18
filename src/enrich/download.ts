/**
 * Auto-download helpers for message media.
 *
 * Two tiers, mirroring avemeva:
 *
 *   - `autoDownloadSmall()` always fires inside the enrich pipeline.
 *     Pulls anything ≤ AUTO_DOWNLOAD_MAX_SIZE bytes — typically photos,
 *     stickers, voice notes, small docs. Gives the agent a local file
 *     path inline, no flag required.
 *
 *   - `autoDownloadAll()` fires on `--auto-download`. No size cap;
 *     suitable when the agent explicitly asked.
 *
 * Both attach a `downloadPath` field to each affected message. Failures
 * are silent — the absence of `downloadPath` is the signal.
 */
import { join } from 'node:path';

import { ensureDownloadsDir } from '../helpers.js';

export const AUTO_DOWNLOAD_MAX_SIZE = 1_048_576; // 1 MB

type Client = any;
type Message = any;

/**
 * Walk through a gram.js Document/Photo media and return the byte size if known.
 * Photos: take the largest size. Documents: their `size` field is in bytes.
 */
function mediaSizeBytes(m: Message): number | null {
  const media = m.media;
  if (!media) return null;
  if (media.className === 'MessageMediaPhoto') {
    const sizes = media.photo?.sizes ?? [];
    let max = 0;
    for (const s of sizes) {
      const bytes = s.size ?? s.bytes ?? 0;
      if (bytes > max) max = bytes;
    }
    return max || null;
  }
  if (media.className === 'MessageMediaDocument') {
    const size = Number(media.document?.size ?? 0);
    return size || null;
  }
  return null;
}

/** Default predicate for what counts as "small content worth fetching inline". */
function shouldFetchSmall(m: Message): boolean {
  const cls = m.media?.className;
  if (!cls) return false;
  // Photos / stickers / small audio — always useful to caption / transcribe.
  const eager = cls === 'MessageMediaPhoto' || m.sticker || m.voice;
  if (!eager) return false;
  const size = mediaSizeBytes(m);
  if (size == null) return true; // unknown size — assume small
  return size <= AUTO_DOWNLOAD_MAX_SIZE;
}

async function downloadOne(client: Client, m: Message, accountId: string): Promise<string | null> {
  const dir = ensureDownloadsDir();
  const path = join(dir, `${accountId}_${m.id}`);
  try {
    const result = await client.downloadMedia(m, { outputFile: path });
    return typeof result === 'string' ? result : path;
  } catch {
    return null;
  }
}

/**
 * Download any message media ≤ 1 MB. Mutates each message: attaches
 * `downloadPath`. Runs in parallel but bounded — we slice into chunks
 * of 8 to avoid hammering the gram.js media DC pool.
 */
export async function autoDownloadSmall(client: Client, messages: Message[], accountId: string): Promise<void> {
  const eligible = messages.filter(shouldFetchSmall);
  if (!eligible.length) return;
  const CHUNK = 8;
  for (let i = 0; i < eligible.length; i += CHUNK) {
    const slice = eligible.slice(i, i + CHUNK);
    const paths = await Promise.all(slice.map((m) => downloadOne(client, m, accountId)));
    for (let j = 0; j < slice.length; j++) {
      if (paths[j]) slice[j].downloadPath = paths[j];
    }
  }
}

/**
 * Unconditional download — `--auto-download` path. Same parallel chunking,
 * no size predicate.
 */
export async function autoDownloadAll(client: Client, messages: Message[], accountId: string): Promise<void> {
  const eligible = messages.filter((m: Message) => m.media);
  if (!eligible.length) return;
  const CHUNK = 4; // Lower — large docs eat bandwidth.
  for (let i = 0; i < eligible.length; i += CHUNK) {
    const slice = eligible.slice(i, i + CHUNK);
    const paths = await Promise.all(slice.map((m) => downloadOne(client, m, accountId)));
    for (let j = 0; j < slice.length; j++) {
      if (paths[j]) slice[j].downloadPath = paths[j];
    }
  }
}
