/**
 * Speech recognition / transcription for voice and video notes.
 */

import type { TelegramClient } from '@tg/protocol';
import type * as Td from 'tdlib-types';

/** Trigger speech recognition for voice/video notes and poll until complete. Mutates the array. */
export async function transcribeMessages(
  client: TelegramClient,
  msgs: Td.message[],
): Promise<void> {
  const targets: { chatId: number; msgId: number; index: number }[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i] as Td.message;
    const c = msg.content;
    if (c._ === 'messageVoiceNote') {
      const r = c.voice_note.speech_recognition_result;
      if (!r || r._ !== 'speechRecognitionResultText') {
        targets.push({ chatId: msg.chat_id, msgId: msg.id, index: i });
      }
    } else if (c._ === 'messageVideoNote') {
      const r = c.video_note.speech_recognition_result;
      if (!r || r._ !== 'speechRecognitionResultText') {
        targets.push({ chatId: msg.chat_id, msgId: msg.id, index: i });
      }
    }
  }
  if (targets.length === 0) return;

  // Trigger recognition (concurrency 3)
  const CONCURRENCY = 3;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ chatId, msgId }) => {
        try {
          await client.invoke({ _: 'recognizeSpeech', chat_id: chatId, message_id: msgId });
        } catch {
          /* may lack Premium, or already in progress */
        }
      }),
    );
  }

  // Poll until all complete or timeout
  const TIMEOUT_MS = 30_000;
  const POLL_MS = 1_000;
  const start = Date.now();
  const pending = new Set(targets.map((t) => t.index));

  while (pending.size > 0 && Date.now() - start < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    for (const idx of [...pending]) {
      const t = targets.find((x) => x.index === idx);
      if (!t) {
        pending.delete(idx);
        continue;
      }
      try {
        const updated = await client.invoke({
          _: 'getMessage',
          chat_id: t.chatId,
          message_id: t.msgId,
        });
        const c = updated.content;
        let result: Td.SpeechRecognitionResult | undefined;
        if (c._ === 'messageVoiceNote') result = c.voice_note.speech_recognition_result;
        else if (c._ === 'messageVideoNote') result = c.video_note.speech_recognition_result;
        if (
          result?._ === 'speechRecognitionResultText' ||
          result?._ === 'speechRecognitionResultError'
        ) {
          pending.delete(idx);
          msgs[idx] = updated;
        }
      } catch {
        pending.delete(idx);
      }
    }
  }
}
