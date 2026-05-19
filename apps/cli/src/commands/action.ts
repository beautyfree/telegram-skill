import { existsSync, readFileSync } from 'node:fs';
import type { Command } from 'commander';
import type * as Td from 'tdlib-types';
import { enrichMessage } from '../enrich';
import { flattenMessages } from '../flatten';
import { fail, strip, success, warn } from '../output';
import { pending } from '../pending';
import { resolveChatId } from '../resolve';
import { slimMessages } from '../slim';

export function register(parent: Command): void {
  const action = parent.command('action').description('Message actions');

  action
    .command('send')
    .description('Send a message to a chat')
    .argument('<chat>', 'Chat ID, username, or link')
    .argument('[text]', 'Message text (required unless --stdin or --file)')
    .option('--reply-to <n>', 'Reply to a specific message ID')
    .option('--md', 'Parse Telegram MarkdownV2: *bold* _italic_ `code` ~strike~ ||spoiler||')
    .option('--html', 'Parse HTML: <b>bold</b> <i>italic</i> <code>code</code>')
    .option('--silent', 'Send without notification')
    .option('--no-preview', 'Disable link preview')
    .option('--stdin', 'Read message text from stdin (pipe input)')
    .option('--file <path>', 'Read message text from file path')
    .action(
      (
        chatArg: string,
        textArg: string | undefined,
        opts: Record<string, string | boolean | undefined>,
      ) => {
        if (!textArg && !opts.stdin && !opts.file) {
          fail(
            'Missing <text>. Provide text, --stdin, or --file. See --help for usage.',
            'INVALID_ARGS',
          );
        }
        // Handle --stdin and --file synchronously during parse
        let text = textArg ?? '';
        if (opts.stdin) {
          if (process.stdin.isTTY) {
            fail(
              "--stdin requires piped input (e.g., echo 'text' | tg action send me --stdin --html)",
              'INVALID_ARGS',
            );
          }
          // stdin will be read inside the async thunk
        }
        if (opts.file) {
          const filePath = opts.file as string;
          if (!existsSync(filePath)) fail(`File not found: ${filePath}`, 'INVALID_ARGS');
          const content = readFileSync(filePath, 'utf-8');
          if (!content) fail(`File is empty: ${filePath}`, 'INVALID_ARGS');
          text = content;
        }

        pending.action = async (client) => {
          // Read stdin if needed
          if (opts.stdin) {
            const chunks: Buffer[] = [];
            for await (const chunk of process.stdin) {
              chunks.push(chunk as Buffer);
            }
            const stdinText = Buffer.concat(chunks).toString('utf-8').replace(/\n$/, '');
            if (!stdinText) fail('No input received from stdin', 'INVALID_ARGS');
            text = stdinText;
          }

          const chatId = await resolveChatId(client, chatArg);

          let formattedText: Td.formattedText;
          if (opts.md) {
            formattedText = await client.invoke({
              _: 'parseTextEntities',
              text,
              parse_mode: { _: 'textParseModeMarkdown', version: 2 },
            });
          } else if (opts.html) {
            formattedText = await client.invoke({
              _: 'parseTextEntities',
              text,
              parse_mode: { _: 'textParseModeHTML' },
            });
          } else {
            formattedText = { _: 'formattedText', text, entities: [] };
          }

          const inputContent: Td.inputMessageText$Input = {
            _: 'inputMessageText',
            text: formattedText,
            link_preview_options:
              opts.preview === false ? { _: 'linkPreviewOptions', is_disabled: true } : undefined,
            clear_draft: true,
          };

          const SEND_TIMEOUT_MS = 5_000;

          const serverMessage = await new Promise<Td.message>((resolve, reject) => {
            let provisionalId: number | undefined;
            let settled = false;
            let timer: ReturnType<typeof setTimeout> | undefined;

            const cleanup = () => {
              settled = true;
              if (timer) clearTimeout(timer);
              client.off('update', handler);
            };

            function handler(update: Td.Update) {
              if (provisionalId === undefined) return;
              if (
                update._ === 'updateMessageSendSucceeded' &&
                update.old_message_id === provisionalId
              ) {
                cleanup();
                resolve(update.message);
              } else if (
                update._ === 'updateMessageSendFailed' &&
                update.old_message_id === provisionalId
              ) {
                cleanup();
                reject(
                  new Error(
                    `${update.error.message || 'Send failed'}${update.error.code ? ` (${update.error.code})` : ''}`,
                  ),
                );
              }
            }

            client.on('update', handler);

            client
              .invoke({
                _: 'sendMessage',
                chat_id: chatId,
                reply_to: opts.replyTo
                  ? {
                      _: 'inputMessageReplyToMessage',
                      message_id: Number(opts.replyTo),
                    }
                  : undefined,
                options: {
                  _: 'messageSendOptions',
                  disable_notification: !!opts.silent,
                  from_background: false,
                  protect_content: false,
                  update_order_of_installed_sticker_sets: false,
                  scheduling_state: undefined,
                  sending_id: 0,
                },
                input_message_content: inputContent,
              } satisfies Td.sendMessage as Td.sendMessage)
              .then(
                (result) => {
                  if (settled) return;
                  provisionalId = result.id;
                  timer = setTimeout(() => {
                    if (settled) return;
                    cleanup();
                    warn('Timed out waiting for server ID; returning provisional message');
                    resolve(result);
                  }, SEND_TIMEOUT_MS);
                },
                (err) => {
                  if (settled) return;
                  cleanup();
                  reject(err);
                },
              );
          });

          const flat = await enrichMessage(client, serverMessage);
          success(flat);
        };
      },
    );

  action
    .command('edit')
    .description('Edit a sent message')
    .argument('<chat>', 'Chat ID, username, or link')
    .argument('<msgId>', 'Message ID to edit')
    .argument('[text]', 'New message text (required unless --stdin or --file)')
    .option('--md', 'Parse Telegram MarkdownV2: *bold* _italic_ `code` ~strike~ ||spoiler||')
    .option('--html', 'Parse HTML: <b>bold</b> <i>italic</i> <code>code</code>')
    .option('--stdin', 'Read message text from stdin (pipe input)')
    .option('--file <path>', 'Read message text from file path')
    .action(
      (
        chatArg: string,
        msgIdArg: string,
        textArg: string | undefined,
        opts: Record<string, string | boolean | undefined>,
      ) => {
        if (!textArg && !opts.stdin && !opts.file) {
          fail(
            'Missing <text>. Provide text, --stdin, or --file. See --help for usage.',
            'INVALID_ARGS',
          );
        }
        let text = textArg ?? '';
        if (opts.file) {
          const filePath = opts.file as string;
          if (!existsSync(filePath)) fail(`File not found: ${filePath}`, 'INVALID_ARGS');
          const content = readFileSync(filePath, 'utf-8');
          if (!content) fail(`File is empty: ${filePath}`, 'INVALID_ARGS');
          text = content;
        }

        pending.action = async (client) => {
          if (opts.stdin) {
            const chunks: Buffer[] = [];
            for await (const chunk of process.stdin) {
              chunks.push(chunk as Buffer);
            }
            const stdinText = Buffer.concat(chunks).toString('utf-8').replace(/\n$/, '');
            if (!stdinText) fail('No input received from stdin', 'INVALID_ARGS');
            text = stdinText;
          }

          const chatId = await resolveChatId(client, chatArg);

          let formattedText: Td.formattedText;
          if (opts.md) {
            formattedText = await client.invoke({
              _: 'parseTextEntities',
              text,
              parse_mode: { _: 'textParseModeMarkdown', version: 2 },
            });
          } else if (opts.html) {
            formattedText = await client.invoke({
              _: 'parseTextEntities',
              text,
              parse_mode: { _: 'textParseModeHTML' },
            });
          } else {
            formattedText = { _: 'formattedText', text, entities: [] };
          }

          const result = await client.invoke({
            _: 'editMessageText',
            chat_id: chatId,
            message_id: Number(msgIdArg),
            reply_markup: undefined,
            input_message_content: {
              _: 'inputMessageText',
              text: formattedText,
              clear_draft: false,
            },
          } satisfies Td.editMessageText as Td.editMessageText);

          const flat = await enrichMessage(client, result);
          success(flat);
        };
      },
    );

  action
    .command('delete')
    .description('Delete messages from a chat')
    .argument('<chat>', 'Chat ID, username, or link')
    .argument('<msgId...>', 'Message ID(s) to delete')
    .option('--revoke', 'Delete for everyone (default: delete only for yourself)')
    .action((chatArg: string, msgIds: string[], opts: { revoke?: boolean }) => {
      pending.action = async (client) => {
        const chatId = await resolveChatId(client, chatArg);
        const ids = msgIds.map(Number);
        const revoke = !!opts.revoke;
        await client.invoke({
          _: 'deleteMessages',
          chat_id: chatId,
          message_ids: ids,
          revoke,
        });
        success({ chat: chatId, deleted: ids });
      };
    });

  action
    .command('forward')
    .description('Forward messages from one chat to another')
    .argument('<from>', 'Source chat ID, username, or link')
    .argument('<to>', 'Destination chat ID, username, or link')
    .argument('<msgId...>', 'Message ID(s) to forward')
    .option('--silent', 'Forward without notification')
    .action((fromArg: string, toArg: string, msgIds: string[], opts: { silent?: boolean }) => {
      pending.action = async (client) => {
        const fromChatId = await resolveChatId(client, fromArg);
        const toChatId = await resolveChatId(client, toArg);
        const ids = msgIds.map(Number);
        const silent = !!opts.silent;

        const SEND_TIMEOUT_MS = 5_000;

        const confirmedMessages = await new Promise<Td.message[]>((resolve, reject) => {
          const provisionalIds = new Set<number>();
          const confirmed = new Map<number, Td.message>();
          let provisionalCount: number | undefined;
          let settled = false;
          let timer: ReturnType<typeof setTimeout> | undefined;

          const cleanup = () => {
            settled = true;
            if (timer) clearTimeout(timer);
            client.off('update', handler);
          };

          const tryResolve = () => {
            if (provisionalCount !== undefined && confirmed.size >= provisionalCount) {
              cleanup();
              resolve(Array.from(confirmed.values()));
            }
          };

          function handler(update: Td.Update) {
            if (provisionalCount === undefined) return;
            if (
              update._ === 'updateMessageSendSucceeded' &&
              provisionalIds.has(update.old_message_id)
            ) {
              confirmed.set(update.old_message_id, update.message);
              tryResolve();
            } else if (
              update._ === 'updateMessageSendFailed' &&
              provisionalIds.has(update.old_message_id)
            ) {
              provisionalIds.delete(update.old_message_id);
              provisionalCount = provisionalIds.size;
              tryResolve();
            }
          }

          client.on('update', handler);

          client
            .invoke({
              _: 'forwardMessages',
              chat_id: toChatId,
              from_chat_id: fromChatId,
              message_ids: ids,
              options: {
                _: 'messageSendOptions',
                disable_notification: silent,
                from_background: false,
                protect_content: false,
                update_order_of_installed_sticker_sets: false,
                scheduling_state: undefined,
                sending_id: 0,
              },
              send_copy: false,
              remove_caption: false,
            } satisfies Td.forwardMessages as Td.forwardMessages)
            .then(
              (result) => {
                if (settled) return;
                const validMessages = result.messages.filter(
                  (m): m is Td.message => m !== undefined,
                );
                for (const msgObj of validMessages) {
                  provisionalIds.add(msgObj.id);
                }
                provisionalCount = provisionalIds.size;
                if (provisionalCount === 0) {
                  cleanup();
                  resolve([]);
                  return;
                }
                tryResolve();
                timer = setTimeout(() => {
                  if (settled) return;
                  cleanup();
                  if (confirmed.size > 0) {
                    warn(
                      `Timed out waiting for server IDs; ${confirmed.size}/${provisionalCount} confirmed`,
                    );
                    resolve(Array.from(confirmed.values()));
                  } else {
                    warn('Timed out waiting for server IDs; returning provisional messages');
                    resolve(validMessages);
                  }
                }, SEND_TIMEOUT_MS);
              },
              (err) => {
                if (settled) return;
                cleanup();
                reject(err);
              },
            );
        });

        success(flattenMessages(slimMessages(confirmedMessages)));
      };
    });

  action
    .command('pin')
    .description('Pin a message in a chat')
    .argument('<chat>', 'Chat ID, username, or link')
    .argument('<msgId>', 'Message ID to pin')
    .option('--silent', 'Pin without notification')
    .action((chatArg: string, msgIdArg: string, opts: { silent?: boolean }) => {
      pending.action = async (client) => {
        const chatId = await resolveChatId(client, chatArg);
        const silent = !!opts.silent;
        await client.invoke({
          _: 'pinChatMessage',
          chat_id: chatId,
          message_id: Number(msgIdArg),
          disable_notification: silent,
          only_for_self: false,
        });
        success({ chat: chatArg, pinned: Number(msgIdArg) });
      };
    });

  action
    .command('unpin')
    .description('Unpin a message or all messages in a chat')
    .argument('<chat>', 'Chat ID, username, or link')
    .argument('[msgId]', 'Message ID to unpin')
    .option('--all', 'Unpin all messages')
    .action((chatArg: string, msgIdArg: string | undefined, opts: { all?: boolean }) => {
      pending.action = async (client) => {
        const chatId = await resolveChatId(client, chatArg);
        if (opts.all) {
          await client.invoke({
            _: 'unpinAllChatMessages',
            chat_id: chatId,
          });
          success({ chat: chatArg, unpinnedAll: true });
        } else {
          if (!msgIdArg) fail('Missing <msgId> or --all flag', 'INVALID_ARGS');
          await client.invoke({
            _: 'unpinChatMessage',
            chat_id: chatId,
            message_id: Number(msgIdArg),
          });
          success({ chat: chatArg, unpinned: Number(msgIdArg) });
        }
      };
    });

  action
    .command('react')
    .description('Add or remove a reaction on a message')
    .argument('<chat>', 'Chat ID, username, or link')
    .argument('<msgId>', 'Message ID')
    .argument('<emoji>', 'Emoji reaction')
    .option('--remove', 'Remove the reaction instead of adding')
    .option('--big', 'Send big animation')
    .action(
      (
        chatArg: string,
        msgIdArg: string,
        emojiArg: string,
        opts: { remove?: boolean; big?: boolean },
      ) => {
        pending.action = async (client) => {
          const chatId = await resolveChatId(client, chatArg);
          const msgId = Number(msgIdArg);
          const emoji = emojiArg.replace(/[\uFE0E\uFE0F]/g, '');
          const remove = !!opts.remove;
          const big = !!opts.big;

          try {
            if (remove) {
              await client.invoke({
                _: 'removeMessageReaction',
                chat_id: chatId,
                message_id: msgId,
                reaction_type: { _: 'reactionTypeEmoji', emoji },
              });
            } else {
              await client.invoke({
                _: 'addMessageReaction',
                chat_id: chatId,
                message_id: msgId,
                reaction_type: { _: 'reactionTypeEmoji', emoji },
                is_big: big,
                update_recent_reactions: true,
              });
            }
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            if (/REACTION_INVALID|reaction.*isn.t available/i.test(msg)) {
              fail(
                `Reaction "${emoji}" is invalid — this emoji may not be allowed in this chat`,
                'INVALID_ARGS',
              );
            }
            throw e;
          }
          success({
            chat: chatArg,
            msgId,
            emoji,
            action: remove ? 'removed' : 'added',
          });
        };
      },
    );

  action
    .command('click')
    .description('Click an inline keyboard button')
    .argument('<chat>', 'Chat ID, username, or link')
    .argument('<messageId>', 'Message ID')
    .argument('<button>', 'Button index or text')
    .action((chatArg: string, messageIdArg: string, buttonArg: string) => {
      pending.action = async (client) => {
        const chatId = await resolveChatId(client, chatArg);
        const messageId = Number(messageIdArg);
        if (!Number.isFinite(messageId) || messageId <= 0)
          fail('Invalid message ID', 'INVALID_ARGS');

        const msgObj = await client.invoke({
          _: 'getMessage',
          chat_id: chatId,
          message_id: messageId,
        });

        if (!msgObj.reply_markup || msgObj.reply_markup._ !== 'replyMarkupInlineKeyboard') {
          fail('Message has no inline keyboard', 'INVALID_ARGS');
        }

        const allButtons: Td.inlineKeyboardButton[] = [];
        for (const row of msgObj.reply_markup.rows) {
          for (const btn of row) allButtons.push(btn);
        }

        if (allButtons.length === 0) fail('Inline keyboard has no buttons', 'INVALID_ARGS');

        let target: Td.inlineKeyboardButton | undefined;
        const idx = Number(buttonArg);
        if (Number.isFinite(idx) && idx >= 0 && idx === Math.floor(idx)) {
          target = allButtons[idx];
          if (!target)
            fail(`Button index ${idx} out of range (0-${allButtons.length - 1})`, 'INVALID_ARGS');
        } else {
          const lower = buttonArg.toLowerCase();
          target = allButtons.find((b) => b.text.toLowerCase() === lower);
          if (!target) {
            const available = allButtons.map((b, i) => `${i}: "${b.text}"`).join(', ');
            fail(`No button matching "${buttonArg}". Available: ${available}`, 'NOT_FOUND');
          }
        }

        const btnType = target.type;
        switch (btnType._) {
          case 'inlineKeyboardButtonTypeCallback': {
            const answer = await client.invoke({
              _: 'getCallbackQueryAnswer',
              chat_id: chatId,
              message_id: messageId,
              payload: { _: 'callbackQueryPayloadData', data: btnType.data },
            });
            return success(
              strip({
                clicked: target.text,
                type: 'callback',
                answer: strip({
                  text: answer.text || undefined,
                  show_alert: answer.show_alert || undefined,
                  url: answer.url || undefined,
                }),
              }),
            );
          }
          case 'inlineKeyboardButtonTypeUrl':
            return success({ clicked: target.text, type: 'url', url: btnType.url });
          case 'inlineKeyboardButtonTypeWebApp':
            return success({ clicked: target.text, type: 'web_app', url: btnType.url });
          case 'inlineKeyboardButtonTypeLoginUrl':
            return success({ clicked: target.text, type: 'login_url', url: btnType.url });
          case 'inlineKeyboardButtonTypeSwitchInline':
            return success({
              clicked: target.text,
              type: 'switch_inline',
              query: btnType.query,
            });
          case 'inlineKeyboardButtonTypeCopyText':
            return success({
              clicked: target.text,
              type: 'copy_text',
              text: btnType.text,
            });
          case 'inlineKeyboardButtonTypeUser':
            return success({
              clicked: target.text,
              type: 'user',
              user_id: btnType.user_id,
            });
          case 'inlineKeyboardButtonTypeBuy':
            return fail('Buy buttons cannot be clicked via CLI', 'INVALID_ARGS');
          case 'inlineKeyboardButtonTypeCallbackGame':
            return fail('Game buttons cannot be clicked via CLI', 'INVALID_ARGS');
          case 'inlineKeyboardButtonTypeCallbackWithPassword':
            return fail('Password-protected buttons are not supported via CLI', 'INVALID_ARGS');
          default:
            return fail('Unsupported button type', 'INVALID_ARGS');
        }
      };
    });
}
