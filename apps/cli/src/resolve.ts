/**
 * Entity resolution — convert raw user input to TDLib IDs.
 *
 * Accepts: numeric ID, @username, phone, "me"/"self".
 * Uses TelegramClient.invoke() which has the same Invoke signature as tdl.Client.
 */

import type { TelegramClient } from '@tg/protocol';

/**
 * Parse a raw entity string into a number (if numeric) or pass through as string.
 * Strips t.me link prefixes so they resolve as usernames.
 */
export function parseEntity(raw: string): string | number {
  if (raw === 'me' || raw === 'self') return raw;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  // Strip t.me link prefixes → username
  let cleaned = raw;
  for (const prefix of ['https://t.me/', 'http://t.me/', 't.me/']) {
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length);
      break;
    }
  }
  return cleaned;
}

/**
 * Resolve a raw entity string to a TDLib user/chat ID (number).
 *
 * - "me" / "self" → getMe().id
 * - numeric → use directly
 * - string → searchPublicChat(username)
 */
export async function resolveEntity(client: TelegramClient, raw: string): Promise<number> {
  if (raw === 'me' || raw === 'self') {
    const me = await client.invoke({ _: 'getMe' });
    return me.id;
  }
  const parsed = parseEntity(raw);
  if (typeof parsed === 'number') {
    return parsed;
  }
  // Phone number: starts with + followed by digits
  if (/^\+\d+$/.test(parsed)) {
    const user = await client.invoke({
      _: 'searchUserByPhoneNumber',
      phone_number: parsed.slice(1),
    });
    return user.id;
  }
  // Username resolution — strip leading @
  const username = parsed.startsWith('@') ? parsed.slice(1) : parsed;
  const chat = await client.invoke({ _: 'searchPublicChat', username });
  return chat.id;
}

/**
 * Resolve a raw entity string to a TDLib chat_id, creating a private chat if needed.
 *
 * For positive user IDs, attempts getChat first; if that fails, creates a private chat.
 * For negative IDs (already chat IDs), uses them directly.
 */
export async function resolveChatId(client: TelegramClient, raw: string): Promise<number> {
  if (raw === 'me' || raw === 'self') {
    const me = await client.invoke({ _: 'getMe' });
    const chat = await client.invoke({
      _: 'createPrivateChat',
      user_id: me.id,
      force: false,
    });
    return chat.id;
  }
  const parsed = parseEntity(raw);
  if (typeof parsed === 'number') {
    // Positive numbers might be user IDs — need createPrivateChat
    // Negative numbers are already chat IDs
    if (parsed > 0) {
      try {
        await client.invoke({ _: 'getChat', chat_id: parsed });
        return parsed;
      } catch {
        const chat = await client.invoke({
          _: 'createPrivateChat',
          user_id: parsed,
          force: false,
        });
        return chat.id;
      }
    }
    return parsed;
  }
  // Phone number: starts with + followed by digits
  if (/^\+\d+$/.test(parsed)) {
    const user = await client.invoke({
      _: 'searchUserByPhoneNumber',
      phone_number: parsed.slice(1),
    });
    const chat = await client.invoke({
      _: 'createPrivateChat',
      user_id: user.id,
      force: false,
    });
    return chat.id;
  }
  // Username resolution
  const username = parsed.startsWith('@') ? parsed.slice(1) : parsed;
  const chat = await client.invoke({ _: 'searchPublicChat', username });
  return chat.id;
}
