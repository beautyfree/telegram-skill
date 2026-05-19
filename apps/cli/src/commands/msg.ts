import type { Command } from 'commander';
import type * as Td from 'tdlib-types';
import { enrichMessage, enrichMessages, enrichOpts } from '../enrich';
import { flattenMessages } from '../flatten';
import { fail, success } from '../output';
import { pending } from '../pending';
import { resolveChatId, resolveEntity } from '../resolve';
import { slimMessages } from '../slim';
import {
  CHAT_TYPE_FILTER_MAP,
  CROSS_CHAT_UNSUPPORTED_FILTERS,
  enrichWithContext,
  FILTER_MAP,
  parseLimitOpt,
  truncateContent,
  VALID_SEARCH_TYPES,
} from './_helpers';

export function register(parent: Command): void {
  const msg = parent.command('msg').description('Message operations');

  msg
    .command('list')
    .description('Get message history from a chat')
    .argument('<chat>', 'Chat ID, username, or link')
    .option('--limit <n>', 'Max messages (default: 20)')
    .option('--offset-id <n>', 'Start from this message ID (pagination cursor)')
    .option('--from <user>', 'Filter by sender (username or ID)')
    .option('--query <text>', 'Search text within this chat')
    .option(
      '--filter <type>',
      'Filter by media type: photo, video, document, url, voice, gif, music',
    )
    .option('--min-id <n>', 'Only messages newer than this ID (exclusive floor)')
    .option('--since <n>', 'Only messages after this unix timestamp (server-side filter)')
    .option(
      '--auto-download',
      'Auto-download photos, stickers, voice messages; adds localPath to media',
    )
    .option('--auto-transcribe', 'Auto-transcribe voice/video notes (Telegram Premium)')
    .action((chatArg: string, opts: Record<string, string | boolean | undefined>) => {
      pending.action = async (client) => {
        const chatId = await resolveChatId(client, chatArg);
        const limit = parseLimitOpt(opts.limit as string | undefined, 20);

        // Build flags object for enrichOpts compatibility
        const flags: Record<string, string> = {};
        if (opts.autoDownload) flags['--auto-download'] = 'true';
        if (opts.autoTranscribe) flags['--auto-transcribe'] = 'true';

        // Search mode (--query or --since)
        if (opts.query || opts.since) {
          const query = (opts.query as string) ?? '';
          let filter: Td.SearchMessagesFilter$Input = { _: 'searchMessagesFilterEmpty' };
          if (opts.filter) {
            const filterMap: Record<string, Td.SearchMessagesFilter$Input> = {
              photo: { _: 'searchMessagesFilterPhoto' },
              video: { _: 'searchMessagesFilterVideo' },
              document: { _: 'searchMessagesFilterDocument' },
              url: { _: 'searchMessagesFilterUrl' },
              voice: { _: 'searchMessagesFilterVoiceNote' },
              gif: { _: 'searchMessagesFilterAnimation' },
              music: { _: 'searchMessagesFilterAudio' },
            };
            const f = filterMap[opts.filter as string];
            if (!f)
              fail(
                `Invalid --filter "${opts.filter}". Expected: ${Object.keys(filterMap).join(', ')}`,
                'INVALID_ARGS',
              );
            filter = f;
          }

          let senderOption: Td.MessageSender | undefined;
          if (opts.from) {
            const fromId = await resolveEntity(client, opts.from as string);
            if (fromId > 0) {
              senderOption = { _: 'messageSenderUser', user_id: fromId };
            } else {
              senderOption = { _: 'messageSenderChat', chat_id: fromId };
            }
          }

          const since = opts.since ? Number(opts.since) : undefined;
          const BATCH = 50;
          const MAX_SCAN = 500;
          const matched: Td.message[] = [];
          let cursor = opts.offsetId ? Number(opts.offsetId) : 0;
          let scanned = 0;

          let exhaustedSearch = false;

          while (scanned < MAX_SCAN && !exhaustedSearch) {
            const result = await client.invoke({
              _: 'searchChatMessages',
              chat_id: chatId,
              query,
              sender_id: senderOption,
              from_message_id: cursor,
              offset: 0,
              limit: BATCH,
              filter,
            } satisfies Td.searchChatMessages as Td.searchChatMessages);

            const batch = result.messages.filter(
              (m: Td.message | null): m is Td.message => m !== null,
            );
            if (batch.length === 0) {
              exhaustedSearch = true;
              break;
            }
            scanned += batch.length;
            for (const m of batch) {
              if (since && m.date < since) continue;
              matched.push(m);
            }
            cursor = (batch.at(-1) as Td.message).id;

            const flatCount = flattenMessages(slimMessages(matched)).length;
            if (flatCount >= limit) break;
          }

          const flat = await enrichMessages(client, matched, enrichOpts(flags));
          const sliced = flat.slice(0, limit);
          const hasMore = flat.length > limit || (!exhaustedSearch && scanned < MAX_SCAN);
          const meta = {
            hasMore,
            ...(hasMore && matched.length > 0
              ? { nextOffset: matched[matched.length - 1]?.id }
              : {}),
          };

          success(sliced, meta);
          return;
        }

        // Standard history mode
        let fromMessageId = opts.offsetId ? Number(opts.offsetId) : 0;

        const minId = opts.minId ? Number(opts.minId) : undefined;
        const fromEntity = opts.from ? await resolveEntity(client, opts.from as string) : undefined;

        const clientFilter = (m: Td.message): boolean => {
          if (minId && m.id <= minId) return false;
          if (fromEntity) {
            const senderId =
              m.sender_id._ === 'messageSenderUser'
                ? m.sender_id.user_id
                : m.sender_id._ === 'messageSenderChat'
                  ? m.sender_id.chat_id
                  : 0;
            if (senderId !== fromEntity) return false;
          }
          return true;
        };

        // Media filter in history mode
        if (opts.filter) {
          const filterMap: Record<string, Td.SearchMessagesFilter$Input> = {
            photo: { _: 'searchMessagesFilterPhoto' },
            video: { _: 'searchMessagesFilterVideo' },
            document: { _: 'searchMessagesFilterDocument' },
            url: { _: 'searchMessagesFilterUrl' },
            voice: { _: 'searchMessagesFilterVoiceNote' },
            gif: { _: 'searchMessagesFilterAnimation' },
            music: { _: 'searchMessagesFilterAudio' },
          };
          const f = filterMap[opts.filter as string];
          if (!f)
            fail(
              `Invalid --filter "${opts.filter}". Expected: ${Object.keys(filterMap).join(', ')}`,
              'INVALID_ARGS',
            );

          const BATCH = 50;
          const MAX_SCAN = 500;
          const matched: Td.message[] = [];
          let cursor = fromMessageId;
          let scanned = 0;
          let exhausted = false;

          while (scanned < MAX_SCAN && !exhausted) {
            const result = await client.invoke({
              _: 'searchChatMessages',
              chat_id: chatId,
              query: '',
              from_message_id: cursor,
              offset: 0,
              limit: BATCH,
              filter: f,
            } satisfies Td.searchChatMessages as Td.searchChatMessages);

            const batch = result.messages.filter(
              (m: Td.message | null): m is Td.message => m !== null,
            );
            if (batch.length === 0) {
              exhausted = true;
              break;
            }
            scanned += batch.length;
            for (const m of batch) {
              if (clientFilter(m)) matched.push(m);
            }
            cursor = (batch.at(-1) as Td.message).id;

            const flatCount = flattenMessages(slimMessages(matched)).length;
            if (flatCount >= limit) break;
          }

          const flatFiltered = await enrichMessages(client, matched, enrichOpts(flags));
          const output = flatFiltered.slice(0, limit);
          const more = flatFiltered.length > limit || (!exhausted && scanned < MAX_SCAN);

          success(output, {
            hasMore: more,
            ...(more && matched.length > 0 ? { nextOffset: matched[matched.length - 1]?.id } : {}),
          });
          return;
        }

        // Plain history mode
        const BATCH = 50;
        const MAX_SCAN = 500;
        const matched: Td.message[] = [];
        let scannedHistory = 0;
        let exhaustedHistory = false;

        while (scannedHistory < MAX_SCAN && !exhaustedHistory) {
          const result = await client.invoke({
            _: 'getChatHistory',
            chat_id: chatId,
            from_message_id: fromMessageId,
            offset: 0,
            limit: BATCH,
            only_local: false,
          });

          const batch = result.messages.filter((m): m is Td.message => m != null);
          if (batch.length === 0) {
            exhaustedHistory = true;
            break;
          }
          scannedHistory += batch.length;
          for (const m of batch) {
            if (clientFilter(m)) matched.push(m);
          }
          fromMessageId = (batch.at(-1) as Td.message).id;

          const flatCount = flattenMessages(slimMessages(matched)).length;
          if (flatCount >= limit) break;
        }

        const flatHistory = await enrichMessages(client, matched, enrichOpts(flags));
        const output = flatHistory.slice(0, limit);
        const more = flatHistory.length > limit || (!exhaustedHistory && scannedHistory < MAX_SCAN);
        const nextOffsetMsg = matched[matched.length - 1];

        success(output, {
          hasMore: more,
          ...(more && nextOffsetMsg ? { nextOffset: nextOffsetMsg.id } : {}),
        });
      };
    });

  msg
    .command('get')
    .description('Get a single message by ID')
    .argument('<chat>', 'Chat ID, username, or link')
    .argument('<messageId>', 'Message ID')
    .action((chatArg: string, messageIdArg: string) => {
      pending.action = async (client) => {
        const chatId = await resolveChatId(client, chatArg);
        const messageId = Number(messageIdArg);
        if (!messageId) fail('Invalid message ID', 'INVALID_ARGS');
        const msgObj = await client.invoke({
          _: 'getMessage',
          chat_id: chatId,
          message_id: messageId,
        });
        const flat = await enrichMessage(client, msgObj);
        success(flat);
      };
    });

  msg
    .command('search')
    .description('Search messages across your chats or in a specific chat')
    .argument('[query]', 'Search query')
    .option('--chat <id>', 'Search in a specific chat (default: across all your chats)')
    .option('--limit <n>', 'Max results (default: 20)')
    .option('--from <user>', 'Filter by sender (requires --chat)')
    .option('--since <n>', 'Only messages after this unix timestamp')
    .option('--until <n>', 'Only messages before this unix timestamp (cross-chat only)')
    .option('--type <type>', 'Filter by chat type: private, group, or channel (cross-chat only)')
    .option(
      '--filter <type>',
      'Filter by content: photo, video, document, url, voice, gif, music, media, videonote, mention, pinned',
    )
    .option('--context <n>', 'Include N before + hit + N after in context array')
    .option('--offset <cursor>', 'Pagination cursor from previous nextOffset')
    .option('--full', 'Return full message text (default: truncated to 500 chars)')
    .option('--archived', 'Search in archived chats only (default: main chat list)')
    .option(
      '--auto-download',
      'Auto-download photos, stickers, voice messages; adds localPath to media',
    )
    .option('--auto-transcribe', 'Auto-transcribe voice/video notes (requires Premium)')
    .action((queryArg: string | undefined, opts: Record<string, string | boolean | undefined>) => {
      pending.action = async (client) => {
        const filterValue = opts.filter as string | undefined;
        if (!queryArg && !filterValue)
          fail('Missing <query>. Or use --filter to search by media type.', 'INVALID_ARGS');
        if (filterValue && !FILTER_MAP[filterValue])
          fail(
            `Invalid --filter: ${filterValue}. Valid: ${Object.keys(FILTER_MAP).join(', ')}`,
            'INVALID_ARGS',
          );
        const query = queryArg ?? '';
        const limit = parseLimitOpt(opts.limit as string | undefined, 20);
        let contextN = 0;
        if (opts.context !== undefined) {
          contextN = Number(opts.context);
          if (!Number.isFinite(contextN) || contextN < 1 || contextN !== Math.floor(contextN)) {
            fail('--context must be a positive integer', 'INVALID_ARGS');
          }
        }

        if (opts.since !== undefined) {
          const since = Number(opts.since);
          if (!Number.isFinite(since) || since < 0 || since !== Math.floor(since))
            fail('--since must be a non-negative unix timestamp (integer)', 'INVALID_ARGS');
        }
        if (opts.until !== undefined) {
          const until = Number(opts.until);
          if (!Number.isFinite(until) || until < 0 || until !== Math.floor(until))
            fail('--until must be a non-negative unix timestamp (integer)', 'INVALID_ARGS');
        }

        // Build flags for enrichOpts
        const flags: Record<string, string> = {};
        if (opts.autoDownload) flags['--auto-download'] = 'true';
        if (opts.autoTranscribe) flags['--auto-transcribe'] = 'true';

        if (opts.chat) {
          // Per-chat search
          if (opts.type)
            fail('--type is for cross-chat search only (filters by chat type)', 'INVALID_ARGS');
          if (opts.until) fail('--until is for cross-chat search only', 'INVALID_ARGS');

          const chatId = await resolveChatId(client, opts.chat as string);

          let senderOption: Td.MessageSender | undefined;
          if (opts.from) {
            const fromId = await resolveEntity(client, opts.from as string);
            if (fromId > 0) {
              senderOption = { _: 'messageSenderUser', user_id: fromId };
            } else {
              senderOption = { _: 'messageSenderChat', chat_id: fromId };
            }
          }

          const searchFilter: Td.SearchMessagesFilter$Input = filterValue
            ? ({ _: FILTER_MAP[filterValue] } as Td.SearchMessagesFilter$Input)
            : { _: 'searchMessagesFilterEmpty' };

          const since = opts.since ? Number(opts.since) : undefined;
          const BATCH = 50;
          const MAX_SCAN = 500;
          const matched: Td.message[] = [];
          let cursor = opts.offset ? Number(opts.offset) : 0;
          let scanned = 0;

          while (matched.length < limit && scanned < MAX_SCAN) {
            const result = await client.invoke({
              _: 'searchChatMessages',
              chat_id: chatId,
              query,
              sender_id: senderOption,
              from_message_id: cursor,
              offset: 0,
              limit: since ? BATCH : limit,
              filter: searchFilter,
            } satisfies Td.searchChatMessages as Td.searchChatMessages);

            const batch = result.messages.filter((m): m is Td.message => m !== null);
            if (batch.length === 0) break;
            scanned += batch.length;
            for (const m of batch) {
              if (since && m.date < since) continue;
              matched.push(m);
              if (matched.length >= limit) break;
            }
            cursor = (batch.at(-1) as Td.message).id;
          }
          const messages = matched;

          const full = !!opts.full;
          const flat = await enrichMessages(client, messages, enrichOpts(flags));
          let results: Record<string, unknown>[] = flat.map((fm, idx) => {
            const obj: Record<string, unknown> = {
              ...fm,
              chat_id: (messages[idx] as Td.message).chat_id,
            };
            return full ? obj : truncateContent(obj);
          });

          if (contextN > 0) {
            results = await enrichWithContext(client, chatId, results, contextN);
          }

          const hasMore = messages.length >= limit;
          success(results, {
            hasMore,
            ...(hasMore && messages.length > 0
              ? { nextOffset: messages[messages.length - 1]?.id }
              : {}),
          });
        } else {
          // Cross-chat search
          if (opts.from) {
            fail(
              '--from requires --chat. Cross-chat search does not support sender filtering.',
              'INVALID_ARGS',
            );
          }
          const typeFilter = opts.type as string | undefined;
          if (typeFilter && !VALID_SEARCH_TYPES.has(typeFilter)) {
            fail(
              `Invalid --type: ${typeFilter}. Valid: ${[...VALID_SEARCH_TYPES].join(', ')}`,
              'INVALID_ARGS',
            );
          }
          if (filterValue && CROSS_CHAT_UNSUPPORTED_FILTERS.has(filterValue)) {
            fail(`--filter ${filterValue} requires --chat`, 'INVALID_ARGS');
          }

          let offsetCursor = (opts.offset as string) ?? '';
          const BATCH = 50;
          const MAX_SCAN = 500;
          const matched: Td.message[] = [];
          let scanned = 0;

          while (matched.length < limit && scanned < MAX_SCAN) {
            const searchParams: Record<string, unknown> = {
              _: 'searchMessages',
              chat_list: {
                _: opts.archived !== undefined ? 'chatListArchive' : 'chatListMain',
              },
              query,
              offset: offsetCursor,
              limit: BATCH,
              filter: filterValue ? { _: FILTER_MAP[filterValue] } : undefined,
              min_date: opts.since ? Number(opts.since) : 0,
              max_date: opts.until ? Number(opts.until) : 0,
            };
            if (typeFilter) {
              searchParams.chat_type_filter = { _: CHAT_TYPE_FILTER_MAP[typeFilter] };
            }
            const result = await client.invoke(searchParams as Td.searchMessages);

            const batch = result.messages.filter((m): m is Td.message => m !== null);
            if (batch.length === 0) break;
            scanned += batch.length;

            for (const m of batch) {
              matched.push(m);
              if (matched.length >= limit) break;
            }
            offsetCursor = result.next_offset;
            if (!offsetCursor) break;
          }
          const messages = matched;

          const full = !!opts.full;
          const flat = await enrichMessages(client, messages, enrichOpts(flags));
          const formattedPromises = flat.map(async (fm, idx) => {
            const msgObj = messages[idx] as Td.message;
            let chatTitle = '';
            try {
              const chat = await client.invoke({
                _: 'getChat',
                chat_id: msgObj.chat_id,
              });
              chatTitle = chat.title;
            } catch {
              // skip
            }
            const obj: Record<string, unknown> = {
              ...fm,
              chat_id: msgObj.chat_id,
              chat_title: chatTitle,
            };
            return full ? obj : truncateContent(obj);
          });
          let formatted = await Promise.all(formattedPromises);

          if (contextN > 0) {
            const MAX_CONTEXT = 5;
            const enriched: Record<string, unknown>[] = [];
            for (let i = 0; i < formatted.length; i++) {
              if (i >= MAX_CONTEXT) {
                enriched.push({ ...formatted[i], context: [] });
                continue;
              }
              const msgObj = messages[i];
              if (!msgObj) continue;
              const msgChatId = msgObj.chat_id;
              const msgId = msgObj.id;
              try {
                const ctx = await client.invoke({
                  _: 'getChatHistory',
                  chat_id: msgChatId,
                  from_message_id: msgId,
                  offset: -(contextN + 1),
                  limit: contextN * 2 + 1,
                  only_local: false,
                });
                const context = flattenMessages(
                  slimMessages(ctx.messages.filter((cm): cm is Td.message => cm != null)),
                );
                enriched.push({ ...formatted[i], context });
              } catch {
                enriched.push({ ...formatted[i], context: [] });
              }
            }
            formatted = enriched as typeof formatted;
          }

          const hasMore = messages.length >= limit;
          const nextOffset = hasMore && offsetCursor ? offsetCursor : undefined;
          success(formatted, { hasMore, nextOffset });
        }
      };
    });
}
