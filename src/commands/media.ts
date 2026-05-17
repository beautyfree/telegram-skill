/**
 * `media` command group: send and download files.
 *
 *   media send <chat> <path|url...>  — file, voice note, document, or album
 *   media download <chat> <msgId>    — save attached media to disk
 */
import { join } from 'path';

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

export const media: CmdGroup = { send, download };
