import type { Command } from 'commander';
import type * as Td from 'tdlib-types';
import { enrichMessage } from '../enrich';
import { flattenMessage } from '../flatten';
import { fail, warn } from '../output';
import { pending } from '../pending';
import { resolveChatId } from '../resolve';
import { slimMessage } from '../slim';
import { getChatType, VALID_CHAT_TYPES } from './_helpers';

export function register(parent: Command): void {
  parent
    .command('listen')
    .description('Stream real-time events (NDJSON). Requires --chat or --type.')
    .option('--chat <ids>', 'Comma-separated chat IDs to include')
    .option('--type <type>', 'Include entire category: user, group, or channel')
    .option('--exclude-chat <ids>', 'Comma-separated chat IDs to exclude from included set')
    .option('--exclude-type <type>', 'Exclude category: user, bot, group, or channel')
    .option(
      '--event <types>',
      'Comma-separated event types (default: new_message,edit_message,delete_messages,message_reactions)',
    )
    .option('--incoming', 'Only include incoming messages (filter out outgoing)')
    .option('--auto-download', 'Auto-download photos, stickers, voice messages')
    .action((opts: Record<string, string | boolean | undefined>) => {
      pending.streaming = true;
      pending.action = async (client) => {
        const DEFAULT_EVENTS = new Set([
          'new_message',
          'edit_message',
          'delete_messages',
          'message_reactions',
        ]);
        const eventFilter = opts.event
          ? new Set(
              (opts.event as string)
                .split(',')
                .map((s: string) => s.trim())
                .filter(Boolean),
            )
          : DEFAULT_EVENTS;

        const emit = (event: Record<string, unknown>) => {
          if (!eventFilter.has(event.type as string)) return;
          process.stdout.write(`${JSON.stringify(event)}\n`);
        };

        const typeFilter = opts.type as string | undefined;
        const excludeType = opts.excludeType as string | undefined;
        const rawChatIds =
          (opts.chat as string | undefined)
            ?.split(',')
            .map((s: string) => s.trim())
            .filter(Boolean) ?? [];
        const chatIds = new Set<string>();
        for (const raw of rawChatIds) {
          const resolved = await resolveChatId(client, raw);
          chatIds.add(String(resolved));
        }
        const rawExcludeChatIds =
          (opts.excludeChat as string | undefined)
            ?.split(',')
            .map((s: string) => s.trim())
            .filter(Boolean) ?? [];
        const excludeChatIds = new Set<string>();
        for (const raw of rawExcludeChatIds) {
          const resolved = await resolveChatId(client, raw);
          excludeChatIds.add(String(resolved));
        }
        const downloadMedia = !!opts.autoDownload;
        const incomingOnly = !!opts.incoming;

        if (!chatIds.size && !typeFilter) {
          fail('Must specify --chat or --type (default is all excluded)', 'INVALID_ARGS');
        }

        if (typeFilter && !VALID_CHAT_TYPES.has(typeFilter)) {
          fail(
            `Invalid --type "${typeFilter}". Expected: user, bot, group, or channel`,
            'INVALID_ARGS',
          );
        }
        if (excludeType && !VALID_CHAT_TYPES.has(excludeType)) {
          fail(
            `Invalid --exclude-type "${excludeType}". Expected: user, bot, group, or channel`,
            'INVALID_ARGS',
          );
        }

        const chatTypeCache = new Map<number, 'user' | 'bot' | 'group' | 'channel' | 'unknown'>();
        const botChatIds = new Set<number>();

        const getCachedChatType = async (
          chatIdNum: number,
        ): Promise<'user' | 'bot' | 'group' | 'channel' | 'unknown'> => {
          const cached = chatTypeCache.get(chatIdNum);
          if (cached) return cached;
          try {
            const chat = await client.invoke({
              _: 'getChat',
              chat_id: chatIdNum,
            });
            if (chat.type._ === 'chatTypePrivate') {
              try {
                const user = await client.invoke({ _: 'getUser', user_id: chat.type.user_id });
                if (user.type._ === 'userTypeBot') botChatIds.add(chat.id);
              } catch {
                /* skip */
              }
            }
            const t = getChatType(chat, botChatIds);
            chatTypeCache.set(chatIdNum, t);
            return t;
          } catch {
            return 'unknown';
          }
        };

        const shouldSkip = async (chatIdNum: number): Promise<boolean> => {
          const chatIdStr = chatIdNum.toString();
          const chatType = await getCachedChatType(chatIdNum);

          if (excludeChatIds.size && excludeChatIds.has(chatIdStr)) return true;
          if (excludeType && chatType === excludeType) return true;
          if (chatIds.size && chatIds.has(chatIdStr)) return false;
          if (typeFilter && chatType === typeFilter) return false;
          return true;
        };

        let wasDisconnected = false;

        client.on('update', (update: Td.Update) => {
          (async () => {
            try {
              if (update._ === 'updateAuthorizationState') {
                emit({
                  type: 'auth_state',
                  authorization_state: update.authorization_state,
                });
              }

              if (update._ === 'updateConnectionState') {
                if (update.state._ === 'connectionStateReady') {
                  if (wasDisconnected) {
                    emit({ type: 'reconnected' });
                    wasDisconnected = false;
                  }
                } else {
                  wasDisconnected = true;
                }
              }

              if (update._ === 'updateNewMessage') {
                const msg = update.message;
                if (await shouldSkip(msg.chat_id)) return;
                if (incomingOnly && msg.is_outgoing) return;
                const flatMsg = await enrichMessage(client, msg, {
                  autoDownload: downloadMedia,
                });
                emit({
                  type: 'new_message',
                  chat_id: msg.chat_id,
                  message: flatMsg,
                });
              }

              if (update._ === 'updateMessageContent') {
                if (await shouldSkip(update.chat_id)) return;
                try {
                  const msg = await client.invoke({
                    _: 'getMessage',
                    chat_id: update.chat_id,
                    message_id: update.message_id,
                  });
                  emit({
                    type: 'edit_message',
                    chat_id: update.chat_id,
                    message: flattenMessage(slimMessage(msg)),
                  });
                } catch {
                  /* skip errors */
                }
              }

              if (update._ === 'updateMessageEdited') {
                if (await shouldSkip(update.chat_id)) return;
                try {
                  const msg = await client.invoke({
                    _: 'getMessage',
                    chat_id: update.chat_id,
                    message_id: update.message_id,
                  });
                  emit({
                    type: 'edit_message',
                    chat_id: update.chat_id,
                    message: flattenMessage(slimMessage(msg)),
                  });
                } catch {
                  /* skip errors */
                }
              }

              if (update._ === 'updateDeleteMessages') {
                if (await shouldSkip(update.chat_id)) return;
                if (!update.is_permanent) return;
                emit({
                  type: 'delete_messages',
                  chat_id: update.chat_id,
                  message_ids: update.message_ids,
                });
              }

              if (update._ === 'updateChatReadOutbox') {
                if (await shouldSkip(update.chat_id)) return;
                emit({
                  type: 'read_outbox',
                  chat_id: update.chat_id,
                  last_read_outbox_message_id: update.last_read_outbox_message_id,
                });
              }

              if (update._ === 'updateChatAction') {
                if (await shouldSkip(update.chat_id)) return;
                emit({
                  type: 'user_typing',
                  chat_id: update.chat_id,
                  sender_id: update.sender_id,
                  action: update.action,
                });
              }

              if (update._ === 'updateUserStatus') {
                emit({
                  type: 'user_status',
                  user_id: update.user_id,
                  status: update.status,
                });
              }

              if (update._ === 'updateMessageInteractionInfo') {
                if (await shouldSkip(update.chat_id)) return;
                if (update.interaction_info?.reactions) {
                  emit({
                    type: 'message_reactions',
                    chat_id: update.chat_id,
                    message_id: update.message_id,
                    interaction_info: update.interaction_info,
                  });
                }
              }

              if (update._ === 'updateMessageSendSucceeded') {
                const msg = update.message;
                if (await shouldSkip(msg.chat_id)) return;
                emit({
                  type: 'message_send_succeeded',
                  chat_id: msg.chat_id,
                  old_message_id: update.old_message_id,
                  message: flattenMessage(slimMessage(msg)),
                });
              }
            } catch {
              /* skip handler errors */
            }
          })();
        });

        warn('Listening for events. Press Ctrl+C to stop.');
        await new Promise<void>(() => {});
      };
    });
}
