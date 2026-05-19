import type { Command } from 'commander';
import type * as Td from 'tdlib-types';
import { enrichMembers, enrichUserProfile, type UserProfile } from '../enrich';
import { flattenChats, flattenFindResult } from '../flatten';
import { fail, strip, success } from '../output';
import { pending } from '../pending';
import { resolveChatId } from '../resolve';
import { slimMembers } from '../slim';
import {
  getChatType,
  parseLimitOpt,
  resolveBotChatIds,
  VALID_CHAT_TYPES,
  VALID_FIND_TYPES,
} from './_helpers';

export function register(parent: Command): void {
  const chats = parent.command('chats').description('Chat operations');

  chats
    .command('list')
    .description('List your conversations')
    .option('--limit <n>', 'Max chats to return (default: 40)')
    .option('--archived', 'Include archived chats (shows both main and archived)')
    .option('--unread', 'Only show chats with unread messages')
    .option('--type <type>', 'Filter by chat type: user, bot, group, or channel')
    .option('--offset-date <n>', "Paginate: unix timestamp from previous response's nextOffset")
    .action((opts: Record<string, string | boolean | undefined>) => {
      pending.action = async (client) => {
        const limit = parseLimitOpt(opts.limit as string | undefined, 40);
        const archived = !!opts.archived;
        const typeFilter = opts.type as string | undefined;
        const unreadOnly = !!opts.unread;
        const offsetDate = opts.offsetDate ? Number(opts.offsetDate) : undefined;
        if (offsetDate !== undefined && (!Number.isFinite(offsetDate) || offsetDate < 0)) {
          fail('--offset-date must be a non-negative unix timestamp', 'INVALID_ARGS');
        }
        if (typeFilter && !VALID_CHAT_TYPES.has(typeFilter)) {
          fail(
            `Invalid --type "${typeFilter}". Expected: user, bot, group, or channel`,
            'INVALID_ARGS',
          );
        }
        const chatLists: Td.ChatList[] = [{ _: 'chatListMain' }];
        if (archived) chatLists.push({ _: 'chatListArchive' });
        const isFiltered = !!(typeFilter || unreadOnly || offsetDate);

        if (isFiltered) {
          const BATCH_SIZE = 50;
          const MAX_SCAN = Math.max(limit * 10, 2000);
          const matched: Td.chat[] = [];
          const botChatIds = new Set<number>();
          const seenIds = new Set<number>();

          for (const chatList of chatLists) {
            let totalLoaded = 0;
            let exhausted = false;

            while (totalLoaded < MAX_SCAN && !exhausted) {
              try {
                await client.invoke({
                  _: 'loadChats',
                  chat_list: chatList,
                  limit: BATCH_SIZE,
                });
              } catch {
                exhausted = true;
              }

              const fetchLimit = exhausted ? MAX_SCAN : totalLoaded + BATCH_SIZE;
              const chatIds = await client.invoke({
                _: 'getChats',
                chat_list: chatList,
                limit: fetchLimit,
              });

              const newIds = chatIds.chat_ids.slice(totalLoaded);
              if (newIds.length === 0) {
                exhausted = true;
                break;
              }
              totalLoaded = chatIds.chat_ids.length;

              for (const id of newIds) {
                if (seenIds.has(id)) continue;
                seenIds.add(id);
                try {
                  const chat = await client.invoke({ _: 'getChat', chat_id: id });

                  let isBot = false;
                  if (chat.type._ === 'chatTypePrivate') {
                    try {
                      const user = await client.invoke({
                        _: 'getUser',
                        user_id: chat.type.user_id,
                      });
                      isBot = user.type._ === 'userTypeBot';
                      if (isBot) botChatIds.add(chat.id);
                    } catch {
                      /* skip */
                    }
                  }

                  let passes = true;
                  if (offsetDate && (chat.last_message?.date ?? 0) >= offsetDate) passes = false;
                  if (passes && unreadOnly && chat.unread_count === 0) passes = false;
                  if (passes && typeFilter && getChatType(chat, botChatIds) !== typeFilter)
                    passes = false;
                  if (passes) matched.push(chat);
                } catch {
                  /* skip chats we can't load */
                }
              }
            }
          }

          matched.sort((a, b) => (b.last_message?.date ?? 0) - (a.last_message?.date ?? 0));
          const filtered = matched.slice(0, limit);
          const hasMore = filtered.length >= limit;

          const lastChat = filtered[filtered.length - 1];
          const lastDate = lastChat?.last_message?.date;

          const flatF = flattenChats(filtered, botChatIds);
          const metaF = { hasMore, nextOffset: hasMore && lastDate ? lastDate : undefined };

          success(flatF, metaF);
        } else {
          const allChatIds: number[] = [];
          const seenIds = new Set<number>();

          for (const chatList of chatLists) {
            try {
              await client.invoke({
                _: 'loadChats',
                chat_list: chatList,
                limit,
              });
            } catch {
              // loadChats throws when there are no more chats
            }

            const chatIds = await client.invoke({
              _: 'getChats',
              chat_list: chatList,
              limit,
            });

            for (const id of chatIds.chat_ids) {
              if (!seenIds.has(id)) {
                seenIds.add(id);
                allChatIds.push(id);
              }
            }
          }

          const chatObjects: Td.chat[] = [];
          for (const id of allChatIds) {
            try {
              const chat = await client.invoke({ _: 'getChat', chat_id: id });
              chatObjects.push(chat);
            } catch {
              /* skip chats we can't load */
            }
          }

          const botChatIds = await resolveBotChatIds(client, chatObjects);

          const hasMore = allChatIds.length >= limit;
          const lastChat = chatObjects[chatObjects.length - 1];
          const lastDate = lastChat?.last_message?.date;

          const flatU = flattenChats(chatObjects, botChatIds);
          const metaU = { hasMore, nextOffset: hasMore && lastDate ? lastDate : undefined };

          success(flatU, metaU);
        }
      };
    });

  chats
    .command('search')
    .description('Search chats, bots, groups, or channels by name')
    .argument('<query>', 'Search query')
    .option('--type <type>', 'Filter: chat, bot, group, or channel')
    .option('--limit <n>', 'Max results (default: 50)')
    .option('--archived', 'Show only archived chats (default: excludes archived)')
    .option('--global', 'Include public Telegram search (network call)')
    .action((query: string, opts: Record<string, string | boolean | undefined>) => {
      pending.action = async (client) => {
        const limit = parseLimitOpt(opts.limit as string | undefined, 50);
        const typeFilter = opts.type as string | undefined;
        if (typeFilter && !VALID_FIND_TYPES.has(typeFilter))
          fail(
            `Invalid --type: ${typeFilter}. Valid: ${[...VALID_FIND_TYPES].join(', ')}`,
            'INVALID_ARGS',
          );
        const isGlobal = !!opts.global;

        const searches: Promise<{ chat_ids: number[] }>[] = [
          client
            .invoke({ _: 'searchChats', query, limit: 50 })
            .catch(() => ({ chat_ids: [] as number[] })),
          client
            .invoke({ _: 'searchChatsOnServer', query, limit: 50 })
            .catch(() => ({ chat_ids: [] as number[] })),
        ];
        if (isGlobal) {
          searches.push(
            client
              .invoke({ _: 'searchPublicChats', query })
              .catch(() => ({ chat_ids: [] as number[] })),
          );
        }
        const searchResults = await Promise.all(searches);

        const uniqueChatIds = new Set<number>();
        for (const res of searchResults) {
          for (const id of res.chat_ids) uniqueChatIds.add(id);
        }

        type FindResult = {
          chat: Td.chat;
          user?: Td.user;
          description?: string;
          link_preview?: string;
          personalChannel?: UserProfile['personal_channel'];
        };

        const resolvePromises = [...uniqueChatIds].map(
          async (chatId): Promise<FindResult | null> => {
            try {
              const chat = await client.invoke({ _: 'getChat', chat_id: chatId });
              const result: FindResult = { chat };

              if (chat.type._ === 'chatTypePrivate') {
                const userId = chat.type.user_id;
                const user = await client
                  .invoke({ _: 'getUser', user_id: userId })
                  .catch(() => undefined);
                result.user = user;
                const profile = await enrichUserProfile(client, userId);
                if (profile) {
                  result.description = profile.description;
                  result.link_preview = profile.link_preview;
                  result.personalChannel = profile.personal_channel;
                }
              } else if (chat.type._ === 'chatTypeSupergroup') {
                try {
                  const sgFull = await client.invoke({
                    _: 'getSupergroupFullInfo',
                    supergroup_id: chat.type.supergroup_id,
                  });
                  result.description = sgFull.description || undefined;
                } catch {
                  // skip
                }
              } else if (chat.type._ === 'chatTypeBasicGroup') {
                try {
                  const bgFull = await client.invoke({
                    _: 'getBasicGroupFullInfo',
                    basic_group_id: chat.type.basic_group_id,
                  });
                  result.description = bgFull.description || undefined;
                } catch {
                  // skip
                }
              }

              return result;
            } catch {
              return null;
            }
          },
        );

        const allResults = (await Promise.all(resolvePromises)).filter(
          (r): r is FindResult => r !== null,
        );

        const showArchived = opts.archived !== undefined;
        const archiveFiltered = allResults.filter(({ chat }) => {
          const isArchived = chat.positions?.some((p) => p.list._ === 'chatListArchive') ?? false;
          return showArchived ? isArchived : !isArchived;
        });

        const filtered = typeFilter
          ? archiveFiltered.filter(({ chat, user }) => {
              const chatType = chat.type._;
              switch (typeFilter) {
                case 'bot':
                  return chatType === 'chatTypePrivate' && user?.type._ === 'userTypeBot';
                case 'channel':
                  return (
                    chatType === 'chatTypeSupergroup' &&
                    (chat.type as Td.chatTypeSupergroup).is_channel
                  );
                case 'group':
                  return (
                    chatType === 'chatTypeBasicGroup' ||
                    (chatType === 'chatTypeSupergroup' &&
                      !(chat.type as Td.chatTypeSupergroup).is_channel)
                  );
                case 'chat':
                  return chatType === 'chatTypePrivate';
                default:
                  return true;
              }
            })
          : archiveFiltered;

        filtered.sort((a, b) => {
          const aDate = a.chat.last_message?.date ?? 0;
          const bDate = b.chat.last_message?.date ?? 0;
          return bDate - aDate;
        });

        const sliced = filtered.slice(0, limit);
        const results = sliced.map(({ chat, user, description, link_preview, personalChannel }) =>
          flattenFindResult(chat, {
            isBot: user?.type._ === 'userTypeBot',
            description,
            link_preview,
            personalChannel,
          }),
        );

        success(results, {
          hasMore: filtered.length > limit ? true : undefined,
        });
      };
    });

  chats
    .command('members')
    .description('List members of a group or channel')
    .argument('<chat>', 'Chat ID, username, or link')
    .option('--limit <n>', 'Max members (default: 100)')
    .option('--query <text>', 'Search members by name')
    .option('--offset <n>', 'Offset for pagination')
    .option('--type <type>', 'Filter by type: bot, admin, recent (default: recent)')
    .option('--filter <type>', 'Alias for --type')
    .action((chatArg: string, opts: Record<string, string | boolean | undefined>) => {
      pending.action = async (client) => {
        const chatId = await resolveChatId(client, chatArg);
        const chat = await client.invoke({ _: 'getChat', chat_id: chatId });
        const limit = parseLimitOpt(opts.limit as string | undefined, 100);
        const search = (opts.query as string) || '';
        const offset = opts.offset ? Number(opts.offset) : 0;

        const typeFlag = (opts.type as string) ?? (opts.filter as string);

        if (chat.type._ === 'chatTypeSupergroup') {
          let filter: Td.SupergroupMembersFilter$Input;
          if (typeFlag === 'bot') {
            filter = { _: 'supergroupMembersFilterBots' };
          } else if (typeFlag === 'admin') {
            filter = { _: 'supergroupMembersFilterAdministrators' };
          } else if (search) {
            filter = { _: 'supergroupMembersFilterSearch', query: search };
          } else {
            filter = { _: 'supergroupMembersFilterRecent' };
          }

          const result = await client.invoke({
            _: 'getSupergroupMembers',
            supergroup_id: chat.type.supergroup_id,
            filter,
            offset,
            limit,
          });

          const hasMore = result.members.length >= limit;
          const flat = await enrichMembers(client, slimMembers(result.members));
          success(strip(flat), {
            hasMore,
            nextOffset: hasMore ? offset + limit : undefined,
          });
        } else if (chat.type._ === 'chatTypeBasicGroup') {
          const result = await client.invoke({
            _: 'getBasicGroupFullInfo',
            basic_group_id: chat.type.basic_group_id,
          });

          let members = result.members;
          if (search) {
            const q = search.toLowerCase();
            const filteredMembers: typeof members = [];
            for (const m of members) {
              const userId = m.member_id._ === 'messageSenderUser' ? m.member_id.user_id : 0;
              if (userId) {
                try {
                  const user = await client.invoke({
                    _: 'getUser',
                    user_id: userId,
                  });
                  const name = [user.first_name, user.last_name]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                  if (name.includes(q)) filteredMembers.push(m);
                } catch {
                  // skip unresolvable users
                }
              }
            }
            members = filteredMembers;
          }
          if (typeFlag === 'bot') {
            const botMembers: typeof members = [];
            for (const m of members) {
              const userId = m.member_id._ === 'messageSenderUser' ? m.member_id.user_id : 0;
              if (userId) {
                try {
                  const user = await client.invoke({
                    _: 'getUser',
                    user_id: userId,
                  });
                  if (user.type._ === 'userTypeBot') botMembers.push(m);
                } catch {
                  // skip
                }
              }
            }
            members = botMembers;
          } else if (typeFlag === 'admin') {
            members = members.filter(
              (m) =>
                m.status._ === 'chatMemberStatusAdministrator' ||
                m.status._ === 'chatMemberStatusCreator',
            );
          }

          const sliced = members.slice(offset, offset + limit);
          const hasMore = members.length > offset + limit;
          const flat = await enrichMembers(client, slimMembers(sliced));
          success(strip(flat), {
            hasMore,
            nextOffset: hasMore ? offset + limit : undefined,
          });
        } else {
          fail('Chat is not a group or channel', 'INVALID_ARGS');
        }
      };
    });
}
