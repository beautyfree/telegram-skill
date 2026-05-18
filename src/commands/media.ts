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
import { captionFiles, downloadCaptionModel } from '../caption/client.js';
import { unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

const send: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  const paths = args.slice(1);
  if (paths.length === 0) fail('Provide at least one file path or URL', 'INVALID_ARGS');
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
    if (!message || !(message as any).media) fail('No media on that message', 'NOT_FOUND');
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
        fail('Telegram Premium required for server-side transcription.', 'PREMIUM');
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
    if (!message || !(message as any).media) fail('No media on that message', 'NOT_FOUND');
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

/**
 * `media caption-run <file...>` — caption one or more local image files.
 *
 * Same model and daemon as `media caption <chat> <msgId>`, but the input
 * is a list of local file paths instead of a Telegram message. Useful for
 * batch jobs / pipelines that already have the bytes on disk and want a
 * caption without round-tripping through Telegram.
 *
 *   telegram-agent media caption-run img1.jpg img2.png [--max-tokens N]
 */
const captionRun: Cmd = async (args, flags) => {
  if (args.length === 0) fail('Provide at least one image path', 'INVALID_ARGS');
  const maxTokens = flagNum(flags, 'max-tokens');
  const { existsSync } = await import('fs');
  const { resolve } = await import('path');
  const paths = args.map((a) => resolve(a));
  for (const p of paths) {
    if (!existsSync(p)) fail(`File not found: ${p}`, 'NOT_FOUND');
  }
  try {
    const result = await captionFiles(paths, maxTokens);
    print(result);
  } catch (err) {
    fail((err as Error).message ?? String(err), 'UNKNOWN');
  }
};

/**
 * `media caption-download` — explicit pre-fetch of Florence-2 weights.
 *
 * Mirrors avemeva's `media caption download` subcommand. Streams hf.co
 * progress to stderr, prints `{ ok: true, dir }` on stdout when done.
 * Use to warm up CI / Docker images before the first real `caption` call.
 */
const captionDownload: Cmd = async () => {
  try {
    const r = await downloadCaptionModel();
    print(r);
  } catch (err) {
    fail((err as Error).message ?? String(err), 'UNKNOWN');
  }
};

export const media: CmdGroup = {
  send,
  download,
  transcribe,
  caption,
  // Spelled with dashes because `caption` is itself a leaf and the
  // command resolver doesn't recurse into a function. `media caption-
  // download` / `media caption-run` are the canonical forms.
  'caption-download': captionDownload,
  'caption-run': captionRun,
};
