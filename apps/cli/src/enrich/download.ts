/**
 * Auto-download helpers for message media files.
 */

import type { TelegramClient } from '@tg/protocol';
import type * as Td from 'tdlib-types';

// --- Auto-download helpers ---

export const AUTO_DOWNLOAD_MAX_SIZE = 1_048_576; // 1MB

function getFile(content: Td.MessageContent): Td.file | null {
  switch (content._) {
    case 'messagePhoto': {
      const sizes = content.photo.sizes;
      if (!sizes.length) return null;
      return sizes[sizes.length - 1]?.photo ?? null;
    }
    case 'messageDocument':
      return content.document.document;
    case 'messageVideo':
      return content.video.video;
    case 'messageAudio':
      return content.audio.audio;
    case 'messageAnimation':
      return content.animation.animation;
    case 'messageVoiceNote':
      return content.voice_note.voice;
    case 'messageVideoNote':
      return content.video_note.video;
    case 'messageSticker':
      return content.sticker.sticker;
    default:
      return null;
  }
}

export function getFileId(content: Td.MessageContent): number | null {
  switch (content._) {
    case 'messagePhoto': {
      // Get largest photo size
      const sizes = content.photo.sizes;
      if (!sizes.length) return null;
      const largest = sizes[sizes.length - 1];
      return largest ? largest.photo.id : null;
    }
    case 'messageDocument':
      return content.document.document.id;
    case 'messageVideo':
      return content.video.video.id;
    case 'messageAudio':
      return content.audio.audio.id;
    case 'messageAnimation':
      return content.animation.animation.id;
    case 'messageVoiceNote':
      return content.voice_note.voice.id;
    case 'messageVideoNote':
      return content.video_note.video.id;
    case 'messageSticker':
      return content.sticker.sticker.id;
    default:
      return null;
  }
}

export function shouldAutoDownloadContent(content: Td.MessageContent): boolean {
  return getFileId(content) !== null;
}

export async function autoDownloadSmall(
  client: TelegramClient,
  rawMsgs: Td.message[],
): Promise<void> {
  const targets: { file: Td.file }[] = [];
  for (const msg of rawMsgs) {
    const file = getFile(msg.content);
    if (!file) continue;
    if (file.local.is_downloading_completed) continue;
    const size = file.size || file.expected_size;
    if (size > 0 && size <= AUTO_DOWNLOAD_MAX_SIZE) {
      targets.push({ file });
    }
  }
  if (!targets.length) return;

  const CONCURRENCY = 3;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (target) => {
        try {
          const updated = await client.invoke({
            _: 'downloadFile',
            file_id: target.file.id,
            priority: 1,
            offset: 0,
            limit: 0,
            synchronous: true,
          });
          // Patch the original file object so slimFile sees the download
          target.file.local = updated.local;
        } catch {}
      }),
    );
  }
}

export async function autoDownloadMessages(
  client: TelegramClient,
  rawMsgs: Td.message[],
): Promise<void> {
  const targets: { file: Td.file }[] = [];
  for (const msg of rawMsgs) {
    if (!shouldAutoDownloadContent(msg.content)) continue;
    const file = getFile(msg.content);
    if (!file) continue;
    if (file.local.is_downloading_completed) continue;
    targets.push({ file });
  }

  const CONCURRENCY = 3;
  for (let batch = 0; batch < targets.length; batch += CONCURRENCY) {
    const chunk = targets.slice(batch, batch + CONCURRENCY);
    await Promise.all(
      chunk.map(async (target) => {
        try {
          const updated = await client.invoke({
            _: 'downloadFile',
            file_id: target.file.id,
            priority: 1,
            offset: 0,
            limit: 0,
            synchronous: true,
          });
          // Patch the original file object so slim/flatten sees the download
          target.file.local = updated.local;
        } catch {
          /* skip failed downloads */
        }
      }),
    );
  }
}
