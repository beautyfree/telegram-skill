/**
 * Flatten TDLib/slim data into agent-friendly JSON.
 * Reduces token usage ~60-70% vs the slim + strip pipeline.
 *
 * Flat format principles:
 * - One key per concept (name, not sender_type + sender_id + sender_name)
 * - Content type implicit from field presence; explicit `content` tag for non-text
 * - Media paths as strings (downloaded) or `true` (not downloaded)
 * - Albums pre-grouped into ids[] + photos[]/videos[]
 * - Dates: smart (today→HH:MM, yesterday→Yesterday, week→Mon, older→Mar 1)
 */

import { homedir } from 'node:os';
import { FILES_DIR } from '@tg/protocol/paths';
import type * as Td from 'tdlib-types';
import { extractPreview } from './slim';
import type {
  CommonGroupInfo,
  ContentAny,
  FlatButton,
  FlatChat,
  FlatCommonGroup,
  FlatFindResult,
  FlatInfo,
  FlatInfoBot,
  FlatInfoChannel,
  FlatInfoEntity,
  FlatInfoGroup,
  FlatInfoUser,
  FlatMessage,
  SlimFile,
  SlimMessage,
} from './types';

export type {
  CommonGroupInfo,
  FlatButton,
  FlatChat,
  FlatCommonGroup,
  FlatFindResult,
  FlatInfo,
  FlatMember,
  FlatMessage,
} from './types';

const HOME = homedir();
const SYMLINK_PREFIX = '~/.tg';

// --- Helpers ---

function clean<T extends Record<string, unknown>>(obj: T): T {
  for (const key in obj) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  const now = new Date();
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${hhmm}`;
  }
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${hhmm}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function shortenPath(p: string): string {
  // ~/.tg symlink points to FILES_DIR (media_cache) — use short form
  if (p.startsWith(FILES_DIR)) return SYMLINK_PREFIX + p.slice(FILES_DIR.length);
  // Fallback: replace home dir with ~
  if (p.startsWith(HOME)) return `~${p.slice(HOME.length)}`;
  return p;
}

function filePath(file: SlimFile): string | true {
  return file.downloaded && file.local_path ? shortenPath(file.local_path) : true;
}

function flattenChatType(t: Td.ChatType, isBot?: boolean): 'user' | 'bot' | 'group' | 'channel' {
  switch (t._) {
    case 'chatTypePrivate':
      return isBot ? 'bot' : 'user';
    case 'chatTypeSecret':
      return 'user';
    case 'chatTypeBasicGroup':
      return 'group';
    case 'chatTypeSupergroup':
      return t.is_channel ? 'channel' : 'group';
  }
}

// --- Inline buttons ---

function flattenButtons(rm: SlimMessage['reply_markup']): FlatButton[][] | undefined {
  if (!rm) return undefined;
  let idx = 0;
  return rm.rows.map((row) =>
    row.map((btn) => {
      const flat: FlatButton = { id: idx++, text: btn.text };
      if (btn.url) flat.url = btn.url;
      return flat;
    }),
  );
}

// --- Single message ---

export function flattenMessage(msg: SlimMessage): FlatMessage {
  // Cast to ContentAny — SlimContent's catch-all member prevents TS narrowing in switch
  const c = msg.content as ContentAny;
  const result: FlatMessage = {
    id: msg.id,
    date: formatTime(msg.date),
    name: msg.is_outgoing ? 'You' : msg.sender_name || `user:${msg.sender_id}`,
  };

  if (msg.reply_to_message_id) result.re = msg.reply_to_message_id;
  if (msg.reply_in_chat_id) result.re_chat = msg.reply_in_chat_id;
  if (msg.forward_sender_name) result.fwd = msg.forward_sender_name;
  if (msg.edit_date) result.edited = true;

  const caption = c.caption as string | undefined;

  switch (c.type) {
    case 'messageText':
      result.text = c.text as string;
      if (c.preview) result.preview = c.preview as string;
      break;

    case 'messagePhoto': {
      const photo = c.photo as { file: SlimFile };
      result.content = 'photo';
      result.photo = filePath(photo.file);
      if (caption) result.text = caption;
      break;
    }

    case 'messageVideo': {
      const vf = c.file as SlimFile;
      result.content = 'video';
      result.video = filePath(vf);
      result.duration = formatDuration(c.duration as number);
      if (caption) result.text = caption;
      break;
    }

    case 'messageDocument': {
      const df = c.file as SlimFile;
      result.content = 'doc';
      result.doc =
        df.downloaded && df.local_path ? shortenPath(df.local_path) : (c.file_name as string);
      if (caption) result.text = caption;
      break;
    }

    case 'messageAudio': {
      result.content = 'audio';
      const title = c.title as string;
      const performer = c.performer as string;
      if (title && performer) result.audio = `${title} — ${performer}`;
      else if (title) result.audio = title;
      else result.audio = c.file_name as string;
      result.duration = formatDuration(c.duration as number);
      if (caption) result.text = caption;
      break;
    }

    case 'messageAnimation': {
      const af = c.file as SlimFile;
      result.content = 'gif';
      result.gif = filePath(af);
      result.duration = formatDuration(c.duration as number);
      if (caption) result.text = caption;
      break;
    }

    case 'messageVoiceNote': {
      const vnf = c.file as SlimFile;
      result.content = 'voice';
      if (vnf.downloaded && vnf.local_path) result.voice = shortenPath(vnf.local_path);
      result.duration = formatDuration(c.duration as number);
      if (c.transcript) result.transcript = c.transcript as string;
      if (caption) result.text = caption;
      break;
    }

    case 'messageVideoNote':
      result.content = 'videonote';
      result.duration = formatDuration(c.duration as number);
      if (c.transcript) result.transcript = c.transcript as string;
      break;

    case 'messageSticker':
      result.content = 'sticker';
      result.sticker = c.emoji as string;
      break;

    case 'messageLocation': {
      const loc = c.location as { latitude: number; longitude: number };
      result.content = 'location';
      result.location = `${loc.latitude}, ${loc.longitude}`;
      break;
    }

    case 'messageContact': {
      const ct = c.contact as { first_name: string; last_name?: string; phone_number: string };
      result.content = 'contact';
      const contactName = [ct.first_name, ct.last_name].filter(Boolean).join(' ');
      result.contact = `${contactName}, +${ct.phone_number}`;
      break;
    }

    case 'messagePoll': {
      const poll = c.poll as {
        question: { text: string };
        options: { text: { text: string }; voter_count: number; vote_percentage: number }[];
        total_voter_count: number;
      };
      result.content = 'poll';
      result.poll = poll.question.text;
      const total = poll.total_voter_count;
      result.options = poll.options.map((o) => {
        const pct = total > 0 ? Math.round((o.voter_count / total) * 100) : 0;
        return `${o.text.text}: ${o.voter_count} (${pct}%)`;
      });
      break;
    }

    case 'messageCall':
      result.content = (c.is_video as boolean) ? 'videocall' : 'call';
      result.duration = formatDuration(c.duration as number);
      break;

    default:
      if (c.type === 'messagePinMessage') {
        result.content = 'pin';
        result.pinned = c.message_id as number;
      } else if (c.type === 'messageChatJoinByLink' || c.type === 'messageChatJoinByRequest') {
        result.content = 'join';
      } else if (c.type === 'messageChatChangeTitle') {
        result.content = 'title';
        result.text = c.title as string;
      } else {
        result.content = c.type.replace(/^message/, '').toLowerCase();
      }
  }

  const buttons = flattenButtons(msg.reply_markup);
  if (buttons) result.buttons = buttons;

  return clean(result as Record<string, unknown>) as FlatMessage;
}

// --- Album merging ---

function flattenAlbum(group: SlimMessage[]): FlatMessage {
  const first = group[0] as SlimMessage;
  const album: FlatMessage = {
    ids: group.map((m) => m.id),
    date: formatTime(first.date),
    name: first.is_outgoing ? 'You' : first.sender_name || `user:${first.sender_id}`,
  };

  if (first.reply_to_message_id) album.re = first.reply_to_message_id;
  if (first.reply_in_chat_id) album.re_chat = first.reply_in_chat_id;
  if (first.forward_sender_name) album.fwd = first.forward_sender_name;
  if (first.edit_date) album.edited = true;

  const firstType = first.content.type;

  if (firstType === 'messagePhoto') {
    album.content = 'photo';
    album.photos = group.map((m) => {
      const pc = m.content as { type: 'messagePhoto'; photo: { file: SlimFile } };
      return filePath(pc.photo.file);
    });
  } else if (firstType === 'messageVideo') {
    album.content = 'video';
    album.videos = group.map((m) => {
      const vc = m.content as { type: 'messageVideo'; file: SlimFile };
      return filePath(vc.file);
    });
    const dur = (first.content as { duration: number }).duration;
    album.duration = formatDuration(dur);
  } else if (firstType === 'messageDocument') {
    album.content = 'doc';
    album.docs = group.map((m) => {
      const dc = m.content as { type: 'messageDocument'; file: SlimFile; file_name: string };
      return dc.file.downloaded && dc.file.local_path
        ? shortenPath(dc.file.local_path)
        : dc.file_name;
    });
  } else {
    album.content = firstType.replace(/^message/, '').toLowerCase();
  }

  // First non-empty caption
  for (const m of group) {
    const ca = m.content as ContentAny;
    if (ca.caption) {
      album.text = ca.caption as string;
      break;
    }
  }

  const buttons = flattenButtons(first.reply_markup);
  if (buttons) album.buttons = buttons;

  return clean(album as Record<string, unknown>) as FlatMessage;
}

// --- Batch with album grouping ---

export function flattenMessages(msgs: SlimMessage[]): FlatMessage[] {
  const result: FlatMessage[] = [];
  let i = 0;

  while (i < msgs.length) {
    const msg = msgs[i] as SlimMessage;

    if (msg.media_album_id) {
      const group: SlimMessage[] = [msg];
      while (i + 1 < msgs.length) {
        const next = msgs[i + 1] as SlimMessage;
        if (next.media_album_id !== msg.media_album_id) break;
        group.push(next);
        i++;
      }
      if (group.length > 1) {
        result.push(flattenAlbum(group));
        i++;
        continue;
      }
    }

    result.push(flattenMessage(msg));
    i++;
  }

  return result;
}

// --- Chat flattening ---

export function flattenChat(chat: Td.chat, botChatIds?: Set<number>): FlatChat {
  const m = chat.last_message;
  return clean({
    id: chat.id,
    title: chat.title,
    type: flattenChatType(chat.type, botChatIds?.has(chat.id)),
    unread: chat.unread_count,
    last: m ? extractPreview(m, 150) : undefined,
    last_date: m ? formatTime(m.date) : undefined,
  }) as FlatChat;
}

export function flattenChats(chats: Td.chat[], botChatIds?: Set<number>): FlatChat[] {
  return chats.map((c) => flattenChat(c, botChatIds));
}

// --- Find result flattening ---

export function flattenFindResult(
  chat: Td.chat,
  extra: {
    isBot?: boolean;
    description?: string;
    link_preview?: string;
    personalChannel?: {
      id: number;
      title: string;
      username: string | null;
      description?: string;
      link_preview?: string;
    };
  },
): FlatFindResult {
  const m = chat.last_message;
  return clean({
    id: chat.id,
    title: chat.title,
    type: flattenChatType(chat.type, extra.isBot),
    last_date: m ? formatTime(m.date) : undefined,
    description: extra.description || undefined,
    link_preview: extra.link_preview || undefined,
    personal_channel: extra.personalChannel || undefined,
  }) as FlatFindResult;
}

// --- Info flattening ---

export function flattenInfo(
  chat: Td.chat,
  extra: {
    user?: Td.user;
    description?: string;
    link_preview?: string;
    personal_channel?: {
      id: number;
      title: string;
      username: string | null;
      description?: string;
      link_preview?: string;
    };
    member_count?: number;
    username?: string;
    groups_in_common?: CommonGroupInfo[];
  },
): FlatInfo {
  const m = chat.last_message;
  const u = extra.user;
  const isBot = u?.type._ === 'userTypeBot';

  const FIVE_MONTHS_AGO = Math.floor(Date.now() / 1000) - 5 * 30 * 24 * 60 * 60;
  const recentGroups = extra.groups_in_common
    ?.filter((g) => g.last_active_date && g.last_active_date >= FIVE_MONTHS_AGO)
    .sort((a, b) => (b.last_active_date ?? 0) - (a.last_active_date ?? 0))
    .map(
      (g) =>
        clean({
          id: g.chat.id,
          title: g.chat.title,
          description: g.description || undefined,
          member_count: g.member_count || undefined,
          last_active: g.last_active_date ? formatTime(g.last_active_date) : undefined,
          last_date: g.chat.last_message ? formatTime(g.chat.last_message.date) : undefined,
        }) as FlatCommonGroup,
    );

  const type = flattenChatType(chat.type, isBot);
  let entity: FlatInfoEntity;
  switch (type) {
    case 'user':
      entity = clean({
        id: chat.id,
        title: chat.title,
        type,
        username: u?.usernames?.active_usernames?.[0] ?? undefined,
        phone: u?.phone_number || undefined,
        bio: extra.description || undefined,
        link_preview: extra.link_preview || undefined,
        personal_channel: extra.personal_channel || undefined,
        is_contact: u?.is_contact || undefined,
        is_premium: u?.is_premium || undefined,
      }) as FlatInfoUser;
      break;
    case 'bot':
      entity = clean({
        id: chat.id,
        title: chat.title,
        type,
        username: u?.usernames?.active_usernames?.[0] ?? undefined,
        description: extra.description || undefined,
        link_preview: extra.link_preview || undefined,
      }) as FlatInfoBot;
      break;
    case 'group':
      entity = clean({
        id: chat.id,
        title: chat.title,
        type,
        description: extra.description || undefined,
        member_count: extra.member_count || undefined,
      }) as FlatInfoGroup;
      break;
    case 'channel':
      entity = clean({
        id: chat.id,
        title: chat.title,
        type,
        username: extra.username || undefined,
        description: extra.description || undefined,
        member_count: extra.member_count || undefined,
      }) as FlatInfoChannel;
      break;
  }

  const result: FlatInfo = {
    entity,
    chat: clean({
      id: chat.id,
      unread: chat.unread_count,
      last: m ? extractPreview(m, 150) : undefined,
      last_date: m ? formatTime(m.date) : undefined,
    }) as FlatInfo['chat'],
  };
  if (recentGroups?.length) result.groups = recentGroups;
  return result;
}
