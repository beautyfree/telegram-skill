/**
 * `media` command group: send, download, transcribe.
 *
 *   media send <chat> <path|url...>      — file, voice note, document, or album
 *   media download <chat> <msgId>        — save attached media to disk
 *   media transcribe <chat> <msgId>      — server-side transcription for
 *                                          voice / round-video notes (Premium)
 */
import { join } from 'path';
import { Api } from 'telegram';

import type { Cmd, CmdGroup } from './_shared.js';
import {
  parsePeer,
  withClient,
  serializeMessage,
  need,
  print,
  fail,
  flagBool,
  flagNum,
  flagStr,
} from './_shared.js';
import { resolveFileArg, ensureDownloadsDir } from '../helpers.js';
import { captionFiles } from '../caption/client.js';
import { unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

const send: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  const paths = args.slice(1);
  if (paths.length === 0) fail('Provide at least one file path or URL');
  await withClient(flags, async (client) => {
    const resolved = await Promise.all(paths.map((p) => resolveFileArg(p)));
    const file = resolved.length === 1 ? resolved[0] : resolved;
    const msg = await client.sendFile(parsePeer(peer), {
      file,
      caption: flagStr(flags, 'caption'),
      voiceNote: flagBool(flags, 'voice'),
      forceDocument: flagBool(flags, 'as-document'),
      silent: flagBool(flags, 'silent'),
      replyTo: flagNum(flags, 'reply-to'),
    } as any);
    print(Array.isArray(msg) ? (msg as any[]).map(serializeMessage) : serializeMessage(msg));
  });
};

const download: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  const messageId = Number(need(args, 1, 'messageId'));
  await withClient(flags, async (client, accountId) => {
    const [message] = await client.getMessages(parsePeer(peer), { ids: [messageId] });
    if (!message || !(message as any).media) fail('No media on that message');
    const explicit = flagStr(flags, 'out');
    const outPath = explicit ?? join(ensureDownloadsDir(), `${accountId}_${messageId}`);
    const result = await client.downloadMedia(message as any, { outputFile: outPath } as any);
    print({ path: typeof result === 'string' ? result : outPath });
  });
};

const transcribe: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  const messageId = Number(need(args, 1, 'messageId'));
  await withClient(flags, async (client) => {
    const inputPeer = await client.getInputEntity(parsePeer(peer));
    try {
      const r: any = await client.invoke(
        new Api.messages.TranscribeAudio({ peer: inputPeer, msgId: messageId }),
      );
      print({
        messageId,
        text: r.text ?? '',
        pending: r.pending ?? false,
        transcriptionId: r.transcriptionId?.toString?.() ?? undefined,
      });
    } catch (err) {
      const msg = (err as Error).message;
      // Most common failure: caller isn't Premium.
      if (/PREMIUM/i.test(msg)) {
        fail('Telegram Premium required for server-side transcription.');
      }
      throw err;
    }
  });
};

/**
 * `media caption <chat> <msgId>` — local image captioning via Florence-2.
 *
 * Downloads the message's image to a temp file, asks the caption daemon
 * for a single-sentence description, returns `{ messageId, text }`.
 * Requires the optional peer dep `@huggingface/transformers` — the daemon
 * surfaces a clean error if missing.
 */
const caption: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  const messageId = Number(need(args, 1, 'messageId'));
  const maxTokens = flagNum(flags, 'max-tokens');
  await withClient(flags, async (client) => {
    const [message] = await client.getMessages(parsePeer(peer), { ids: [messageId] });
    if (!message || !(message as any).media) fail('No media on that message');
    const tmpPath = join(tmpdir(), `tg-agent-caption-${randomBytes(8).toString('hex')}.bin`);
    try {
      await client.downloadMedia(message as any, { outputFile: tmpPath } as any);
      const result = await captionFiles([tmpPath], maxTokens);
      const text = Array.isArray(result) ? result[0]?.text : (result as any).text;
      print({ messageId, text: text ?? '', model: 'Florence-2-base@q4' });
    } finally {
      try { unlinkSync(tmpPath); } catch { /* best-effort */ }
    }
  });
};

export const media: CmdGroup = { send, download, transcribe, caption };
