import type { Command } from 'commander';
import type * as Td from 'tdlib-types';
import { enrichUserProfile, type UserProfile } from '../enrich';
import { type CommonGroupInfo, flattenInfo } from '../flatten';
import { strip, success } from '../output';
import { pending } from '../pending';
import { resolveChatId } from '../resolve';
import { slimUser } from '../slim';
import { isUserContent } from './_helpers';

export function register(parent: Command): void {
  parent
    .command('me')
    .description('Get current user info')
    .action(() => {
      pending.action = async (client) => {
        const me = await client.invoke({ _: 'getMe' });
        success(strip(slimUser(me)));
      };
    });

  parent
    .command('info')
    .description('Get detailed info about a user, group, or channel')
    .argument('<entity>', 'ID, @username, phone, or link')
    .action((entity: string) => {
      pending.action = async (client) => {
        const chatId = await resolveChatId(client, entity);
        const chat = await client.invoke({ _: 'getChat', chat_id: chatId });
        let user: Td.user | undefined;
        let description: string | undefined;
        let link_preview: string | undefined;
        let personalChannel: UserProfile['personal_channel'];
        let memberCount: number | undefined;
        let username: string | undefined;
        let groups: CommonGroupInfo[] | undefined;
        if (chat.type._ === 'chatTypeSupergroup') {
          const sgInfo = await client.invoke({
            _: 'getSupergroupFullInfo',
            supergroup_id: chat.type.supergroup_id,
          });
          const sg = await client.invoke({
            _: 'getSupergroup',
            supergroup_id: chat.type.supergroup_id,
          });
          description = sgInfo.description || undefined;
          memberCount = sgInfo.member_count || undefined;
          username = sg.usernames?.active_usernames?.[0] ?? undefined;
        } else if (chat.type._ === 'chatTypeBasicGroup') {
          const bgInfo = await client.invoke({
            _: 'getBasicGroupFullInfo',
            basic_group_id: chat.type.basic_group_id,
          });
          description = bgInfo.description || undefined;
          memberCount = bgInfo.members.length || undefined;
        } else if (chat.type._ === 'chatTypePrivate') {
          const userId = chat.type.user_id;
          user = await client.invoke({ _: 'getUser', user_id: userId });
          const profile = await enrichUserProfile(client, userId);
          if (profile) {
            description = profile.description;
            link_preview = profile.link_preview;
            personalChannel = profile.personal_channel;
          }
          const fullInfo = await client.invoke({ _: 'getUserFullInfo', user_id: userId });
          if (fullInfo.group_in_common_count > 0) {
            const common = await client.invoke({
              _: 'getGroupsInCommon',
              user_id: userId,
              offset_chat_id: 0,
              limit: 100,
            });
            const chats = await Promise.all(
              common.chat_ids.map((id) => client.invoke({ _: 'getChat', chat_id: id })),
            );
            groups = await Promise.all(
              chats.map(async (g): Promise<CommonGroupInfo> => {
                let description: string | undefined;
                let groupMemberCount: number | undefined;
                if (g.type._ === 'chatTypeSupergroup') {
                  const sgInfo = await client.invoke({
                    _: 'getSupergroupFullInfo',
                    supergroup_id: g.type.supergroup_id,
                  });
                  description = sgInfo.description || undefined;
                  groupMemberCount = sgInfo.member_count || undefined;
                } else if (g.type._ === 'chatTypeBasicGroup') {
                  const bgInfo = await client.invoke({
                    _: 'getBasicGroupFullInfo',
                    basic_group_id: g.type.basic_group_id,
                  });
                  description = bgInfo.description || undefined;
                  groupMemberCount = bgInfo.members.length || undefined;
                }
                let lastActiveDate: number | undefined;
                try {
                  const msgs = await client.invoke({
                    _: 'searchChatMessages',
                    chat_id: g.id,
                    sender_id: { _: 'messageSenderUser', user_id: userId },
                    from_message_id: 0,
                    offset: 0,
                    limit: 5,
                  });
                  const real = msgs.messages.find((m) => m && isUserContent(m));
                  if (real) lastActiveDate = real.date;
                } catch {
                  /* search may fail in some groups */
                }
                return {
                  chat: g,
                  description,
                  member_count: groupMemberCount,
                  last_active_date: lastActiveDate,
                };
              }),
            );
          }
        }
        success(
          flattenInfo(chat, {
            user,
            description,
            link_preview,
            personal_channel: personalChannel,
            member_count: memberCount,
            username,
            groups_in_common: groups,
          }),
        );
      };
    });
}
