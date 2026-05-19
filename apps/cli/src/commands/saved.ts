/**
 * `saved` — Telegram Premium reaction-tags on Saved Messages.
 *
 *   saved tags                 List your tag reactions + counts + custom titles
 *   saved tag-rename           Set/clear the custom title for a tag-emoji
 *   saved default-tags         Server-suggested default emoji set for tagging
 *   saved search               Search Saved Messages with optional tag filter
 *   saved history <peer>       Messages in one saved sub-dialog
 *
 * Telegram exposes Saved-Messages reaction tags through these TDLib methods:
 *   getSavedMessagesTags(saved_messages_topic_id)         → savedMessagesTags
 *   setSavedMessagesTagLabel(tag, label)
 *   searchSavedMessages(saved_messages_topic_id, tag, query, …)
 *
 * All operations target the signed-in user's own Saved Messages chat (the
 * peer for that is the user's own ID — `getMe().id`). Premium-only on the
 * server side — non-Premium accounts get empty tag lists.
 *
 * Adapted from telegram-agent 1.x where this lived on gram.js as a
 * `messages.GetSavedReactionTags` / `messages.UpdateSavedReactionTag`
 * pair. TDLib wraps the same MTProto calls under cleaner names.
 */
import type { Command } from 'commander';
import type * as Td from 'tdlib-types';
import { fail, success, warn } from '../output';
import { pending } from '../pending';

function formatTag(t: any): any {
  // savedMessagesTag → { reaction: { type, emoji | document_id }, count, label }
  const reaction = t.tag ?? t.reaction;
  const out: any = { count: t.count };
  if (reaction?._ === 'reactionTypeEmoji') out.emoji = reaction.emoji;
  else if (reaction?._ === 'reactionTypeCustomEmoji')
    out.customEmojiId = reaction.custom_emoji_id?.toString();
  if (t.label) out.label = t.label;
  return out;
}

function buildReactionType(args: { emoji?: string; customEmojiId?: string }): any {
  if (args.emoji) return { _: 'reactionTypeEmoji', emoji: args.emoji };
  if (args.customEmojiId)
    return { _: 'reactionTypeCustomEmoji', custom_emoji_id: args.customEmojiId };
  fail('--tag <emoji> or --tag-custom <id> required', 'INVALID_ARGS');
}

export function register(parent: Command): void {
  const saved = parent.command('saved').description('Saved Messages reaction-tags (Premium)');

  // --- saved tags ---
  saved
    .command('tags')
    .description('List your Saved Messages reaction tags + counts + custom titles')
    .action(() => {
      pending.action = async (client) => {
        const res: any = await client.invoke({
          _: 'getSavedMessagesTags',
          saved_messages_topic_id: 0,
        });
        const tags = (res?.tags ?? []).map(formatTag);
        success({ tags });
      };
    });

  // --- saved tag-rename ---
  saved
    .command('tag-rename')
    .description('Rename (or clear) the custom title of a tag emoji')
    .argument('<emoji>', 'Tag emoji to rename')
    .argument('[title]', 'New title — omit to clear')
    .action((emoji: string, title: string | undefined) => {
      pending.action = async (client) => {
        await client.invoke({
          _: 'setSavedMessagesTagLabel',
          tag: { _: 'reactionTypeEmoji', emoji },
          label: title ?? '',
        });
        success({ emoji, label: title ?? null });
      };
    });

  // --- saved default-tags ---
  saved
    .command('default-tags')
    .description('Server-suggested default emoji set for tagging Saved Messages')
    .action(() => {
      pending.action = async (client) => {
        // `getDefaultEmojiReactions` exists in TDLib 1.8.30+ but is missing from
        // the `tdlib-types` bindings. Cast through `unknown` to bypass strict typing.
        const res: any = await (client.invoke as (req: unknown) => Promise<any>)({
          _: 'getDefaultEmojiReactions',
        });
        const emojis = (res?.emojis ?? []).map((e: any) => e.emoji ?? e);
        success({ emojis });
      };
    });

  // --- saved search ---
  saved
    .command('search')
    .description('Search Saved Messages by tag, query, or both')
    .option('--tag <emoji>', 'Filter by tag emoji')
    .option('--tag-custom <id>', 'Filter by custom-emoji tag id')
    .option('--query <text>', 'Substring match against message text')
    .option('--limit <n>', 'Max results', '50')
    .action((opts: { tag?: string; tagCustom?: string; query?: string; limit?: string }) => {
      pending.action = async (client) => {
        const tag =
          opts.tag || opts.tagCustom
            ? buildReactionType({ emoji: opts.tag, customEmojiId: opts.tagCustom })
            : undefined;
        const limit = Math.max(1, Math.min(100, Number(opts.limit) || 50));
        const res: any = await client.invoke({
          _: 'searchSavedMessages',
          saved_messages_topic_id: 0,
          tag,
          query: opts.query ?? '',
          from_message_id: 0,
          offset: 0,
          limit,
        });
        const messages: Td.message[] = res?.messages ?? [];
        success({
          totalCount: res?.total_count ?? messages.length,
          items: messages.map((m: any) => ({
            id: m.id,
            date: m.date,
            text: m.content?.text?.text ?? '',
            contentType: m.content?._,
          })),
        });
      };
    });

  // --- saved history ---
  saved
    .command('history')
    .description('Walk Saved Messages history (newest first)')
    .option('--limit <n>', 'Max messages', '50')
    .option('--offset-id <n>', 'Start from this message id (pagination cursor)', '0')
    .action((opts: { limit?: string; offsetId?: string }) => {
      pending.action = async (client) => {
        const me = await client.invoke({ _: 'getMe' });
        const limit = Math.max(1, Math.min(100, Number(opts.limit) || 50));
        const res: any = await client.invoke({
          _: 'getChatHistory',
          chat_id: me.id,
          from_message_id: Number(opts.offsetId) || 0,
          offset: 0,
          limit,
          only_local: false,
        });
        const messages: Td.message[] = res?.messages ?? [];
        if (!messages.length) {
          warn(
            'No Saved Messages — or Telegram still loading the chat. Retry in a moment if you expected results.',
          );
        }
        success({
          items: messages.map((m: any) => ({
            id: m.id,
            date: m.date,
            text: m.content?.text?.text ?? '',
            contentType: m.content?._,
          })),
          hasMore: messages.length >= limit,
          nextOffset: messages.length ? messages[messages.length - 1]?.id : null,
        });
      };
    });
}
