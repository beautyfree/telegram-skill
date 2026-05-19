/**
 * Message enrichment pipeline — download, transcribe, resolve names, flatten.
 */

import type { TelegramClient } from '@tg/protocol';
import type * as Td from 'tdlib-types';
import { flattenMessage, flattenMessages } from '../flatten';
import { slimMessage, slimMessages } from '../slim';
import type { EnrichOpts, FlatMessage } from '../types';
import { autoDownloadMessages, autoDownloadSmall } from './download';
import { addSenderNames } from './names';
import { transcribeMessages } from './transcribe';

export function enrichOpts(flags: Record<string, string>): EnrichOpts {
  return {
    autoDownload: '--auto-download' in flags,
    autoTranscribe: '--auto-transcribe' in flags,
  };
}

/** Slim, resolve names, and flatten messages into agent-friendly format. */
export async function enrichMessages(
  client: TelegramClient,
  msgs: Td.message[],
  opts?: EnrichOpts,
): Promise<FlatMessage[]> {
  await autoDownloadSmall(client, msgs);
  if (opts?.autoDownload) await autoDownloadMessages(client, msgs);
  if (opts?.autoTranscribe) await transcribeMessages(client, msgs);
  const slim = slimMessages(msgs);
  await addSenderNames(client, slim);
  return flattenMessages(slim);
}

/** Slim, resolve names, and flatten a single message. */
export async function enrichMessage(
  client: TelegramClient,
  msg: Td.message,
  opts?: EnrichOpts,
): Promise<FlatMessage> {
  await autoDownloadSmall(client, [msg]);
  if (opts?.autoDownload) await autoDownloadMessages(client, [msg]);
  if (opts?.autoTranscribe) await transcribeMessages(client, [msg]);
  const slim = slimMessage(msg);
  await addSenderNames(client, [slim]);
  return flattenMessage(slim);
}

export type { EnrichOpts, UserProfile } from '../types';
// Re-exports
export { getFileId, shouldAutoDownloadContent } from './download';
export { addSenderNames, slimMessagesWithNames } from './names';
export {
  enrichMembers,
  enrichUserProfile,
  extractFirstUrl,
  extractFirstUrlFromText,
  fetchLinkPreview,
} from './profiles';
export { transcribeMessages } from './transcribe';
