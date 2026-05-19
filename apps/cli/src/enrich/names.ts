/**
 * Name resolution for message senders and forward origins.
 */

import type { TelegramClient } from '@tg/protocol';
import type * as Td from 'tdlib-types';
import { slimMessages } from '../slim';
import type { SlimMessage } from '../types';

// --- Name resolution ---

async function resolveUserName(
  client: TelegramClient,
  cache: Map<string, string>,
  userId: number,
): Promise<string | undefined> {
  const key = `user:${userId}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const user = await client.invoke({ _: 'getUser', user_id: userId });
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
    cache.set(key, name);
    return name;
  } catch {
    return undefined;
  }
}

async function resolveChatName(
  client: TelegramClient,
  cache: Map<string, string>,
  chatId: number,
): Promise<string | undefined> {
  const key = `chat:${chatId}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const chat = await client.invoke({ _: 'getChat', chat_id: chatId });
    cache.set(key, chat.title);
    return chat.title;
  } catch {
    return undefined;
  }
}

/** Resolve sender names and forward origin names onto slim messages. */
export async function addSenderNames(client: TelegramClient, msgs: SlimMessage[]): Promise<void> {
  const cache = new Map<string, string>();

  for (const m of msgs) {
    if (m.sender_type === 'user') {
      m.sender_name = await resolveUserName(client, cache, m.sender_id);
    } else {
      m.sender_name = await resolveChatName(client, cache, m.sender_id);
    }
  }

  for (const m of msgs) {
    const origin = m.forward_info?.origin;
    if (!origin) continue;
    switch (origin._) {
      case 'messageOriginUser':
        m.forward_sender_name = await resolveUserName(client, cache, origin.sender_user_id);
        break;
      case 'messageOriginChat':
        m.forward_sender_name = await resolveChatName(client, cache, origin.sender_chat_id);
        break;
      case 'messageOriginChannel':
        m.forward_sender_name = await resolveChatName(client, cache, origin.chat_id);
        break;
      case 'messageOriginHiddenUser':
        m.forward_sender_name = origin.sender_name;
        break;
    }
  }
}

/** Slim messages and enrich with sender/forward names. */
export async function slimMessagesWithNames(
  client: TelegramClient,
  msgs: Td.message[],
): Promise<SlimMessage[]> {
  const slim = slimMessages(msgs);
  await addSenderNames(client, slim);
  return slim;
}
