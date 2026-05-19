import type { TelegramClient } from '@tg/protocol';
import type * as Td from 'tdlib-types';
import { enrichMessages } from '../enrich';
import { fail } from '../output';

export function parseLimit(flags: Record<string, string>, defaultVal: number): number {
  const raw = flags['--limit'];
  if (raw === undefined) return defaultVal;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n !== Math.floor(n)) {
    fail('--limit must be a positive integer', 'INVALID_ARGS');
  }
  return n;
}

export const VALID_CHAT_TYPES = new Set(['user', 'bot', 'group', 'channel']);

export const VALID_FIND_TYPES = new Set(['chat', 'bot', 'group', 'channel']);

export const VALID_SEARCH_TYPES = new Set(['private', 'group', 'channel']);

export const FILTER_MAP: Record<string, string> = {
  photo: 'searchMessagesFilterPhoto',
  video: 'searchMessagesFilterVideo',
  document: 'searchMessagesFilterDocument',
  url: 'searchMessagesFilterUrl',
  voice: 'searchMessagesFilterVoiceNote',
  gif: 'searchMessagesFilterAnimation',
  music: 'searchMessagesFilterAudio',
  media: 'searchMessagesFilterPhotoAndVideo',
  videonote: 'searchMessagesFilterVideoNote',
  mention: 'searchMessagesFilterMention',
  pinned: 'searchMessagesFilterPinned',
};

export const CROSS_CHAT_UNSUPPORTED_FILTERS = new Set(['mention', 'pinned']);

export const CHAT_TYPE_FILTER_MAP: Record<string, string> = {
  private: 'searchMessagesChatTypeFilterPrivate',
  group: 'searchMessagesChatTypeFilterGroup',
  channel: 'searchMessagesChatTypeFilterChannel',
};

export function getChatType(
  chat: Td.chat,
  botChatIds?: Set<number>,
): 'user' | 'bot' | 'group' | 'channel' | 'unknown' {
  switch (chat.type._) {
    case 'chatTypePrivate':
      return botChatIds?.has(chat.id) ? 'bot' : 'user';
    case 'chatTypeSecret':
      return 'user';
    case 'chatTypeBasicGroup':
      return 'group';
    case 'chatTypeSupergroup':
      return chat.type.is_channel ? 'channel' : 'group';
    default:
      return 'unknown';
  }
}

export const USER_CONTENT_TYPES = new Set([
  'messageText',
  'messagePhoto',
  'messageVideo',
  'messageDocument',
  'messageVoiceNote',
  'messageVideoNote',
  'messageAudio',
  'messageSticker',
  'messageAnimation',
  'messageLocation',
  'messageContact',
  'messagePoll',
  'messageDice',
  'messageStory',
]);

export function isUserContent(m: Td.message): boolean {
  return USER_CONTENT_TYPES.has(m.content._);
}

export async function resolveBotChatIds(
  client: TelegramClient,
  chats: Td.chat[],
): Promise<Set<number>> {
  const botIds = new Set<number>();
  for (const chat of chats) {
    if (chat.type._ === 'chatTypePrivate') {
      try {
        const user = await client.invoke({ _: 'getUser', user_id: chat.type.user_id });
        if (user.type._ === 'userTypeBot') botIds.add(chat.id);
      } catch {
        /* skip */
      }
    }
  }
  return botIds;
}

export function getContentMimeType(content: Td.MessageContent): string {
  switch (content._) {
    case 'messagePhoto':
      return 'image/jpeg';
    case 'messageDocument':
      return content.document.mime_type || 'application/octet-stream';
    case 'messageVideo':
      return content.video.mime_type || 'video/mp4';
    case 'messageAudio':
      return content.audio.mime_type || 'audio/mpeg';
    case 'messageAnimation':
      return content.animation.mime_type || 'video/mp4';
    case 'messageVoiceNote':
      return content.voice_note.mime_type || 'audio/ogg';
    case 'messageVideoNote':
      return 'video/mp4';
    case 'messageSticker':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

export async function enrichWithContext(
  client: TelegramClient,
  chatId: number,
  results: Record<string, unknown>[],
  contextN: number,
): Promise<Record<string, unknown>[]> {
  const MAX_CONTEXT = 5;
  const enriched: Record<string, unknown>[] = [];
  for (let i = 0; i < results.length; i++) {
    const hit = results[i];
    if (!hit) continue;
    if (i >= MAX_CONTEXT) {
      enriched.push({ ...hit, context: [] });
      continue;
    }
    const msgId = hit.id as number;
    try {
      const ctx = await client.invoke({
        _: 'getChatHistory',
        chat_id: chatId,
        from_message_id: msgId,
        offset: -(contextN + 1),
        limit: contextN * 2 + 1,
        only_local: false,
      });
      const context = await enrichMessages(
        client,
        ctx.messages.filter((m): m is Td.message => m != null),
      );
      enriched.push({ ...hit, context });
    } catch {
      enriched.push({ ...hit, context: [] });
    }
  }
  return enriched;
}

export function truncateContent(
  result: Record<string, unknown>,
  maxLen = 500,
): Record<string, unknown> {
  if (typeof result.text === 'string' && result.text.length > maxLen) {
    return { ...result, text: result.text.slice(0, maxLen), truncated: true };
  }
  return result;
}

export function parseLimitOpt(val: string | undefined, defaultVal: number): number {
  if (val === undefined) return defaultVal;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 1 || n !== Math.floor(n)) {
    fail('--limit must be a positive integer', 'INVALID_ARGS');
  }
  return n;
}
