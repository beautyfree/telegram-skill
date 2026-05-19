/**
 * Shared type definitions for the CLI data pipeline.
 * Types only — no runtime code.
 */

import type * as Td from 'tdlib-types';

// --- Slim types (from slim.ts) ---

export type SlimFile = { id: number; size: number; downloaded: boolean; local_path?: string };

export type SlimUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username: string | null;
  phone_number: string;
  type: 'regular' | 'bot' | 'deleted' | 'unknown';
  is_contact: boolean;
  is_verified: boolean;
  is_premium: boolean;
  is_scam: boolean;
  is_fake: boolean;
  active_user_count?: number;
};

export type SlimChat = {
  id: number;
  type: 'user' | 'group' | 'channel';
  title: string;
  unread_count: number;
  last_read_inbox_message_id: number;
  unread_mention_count?: number;
  last_message?: { id: number; date: number; text?: string };
};

export type SlimMessage = {
  id: number;
  sender_type: 'user' | 'chat';
  sender_id: number;
  sender_name?: string;
  chat_id: number;
  is_outgoing: boolean;
  date: number;
  edit_date?: number;
  reply_to_message_id?: number;
  reply_in_chat_id?: number;
  forward_info?: Td.messageForwardInfo;
  forward_sender_name?: string;
  media_album_id?: string;
  content: SlimContent;
  reply_markup?: SlimReplyMarkup;
};

// TDLib types are outdated — runtime uses reply_to object instead of reply_to_message_id
export type MessageReplyTo =
  | {
      _: 'messageReplyToMessage';
      chat_id: number;
      message_id: number;
    }
  | {
      _: 'messageReplyToStory';
      story_sender_chat_id: number;
      story_id: number;
    };

export type SlimContent =
  | { type: 'messageText'; text: string; preview?: string }
  | {
      type: 'messagePhoto';
      caption?: string;
      photo: { width: number; height: number; file: SlimFile };
    }
  | {
      type: 'messageVideo';
      caption?: string;
      file_name: string;
      mime_type: string;
      duration: number;
      width: number;
      height: number;
      file: SlimFile;
    }
  | {
      type: 'messageDocument';
      caption?: string;
      file_name: string;
      mime_type: string;
      file: SlimFile;
    }
  | {
      type: 'messageAudio';
      caption?: string;
      file_name: string;
      mime_type: string;
      duration: number;
      title: string;
      performer: string;
      file: SlimFile;
    }
  | {
      type: 'messageAnimation';
      caption?: string;
      file_name: string;
      mime_type: string;
      duration: number;
      width: number;
      height: number;
      file: SlimFile;
    }
  | {
      type: 'messageVoiceNote';
      caption?: string;
      transcript?: string;
      duration: number;
      mime_type: string;
      file: SlimFile;
    }
  | {
      type: 'messageVideoNote';
      transcript?: string;
      duration: number;
      width: number;
      height: number;
      file: SlimFile;
    }
  | { type: 'messageSticker'; emoji: string }
  | { type: 'messageLocation'; location: Td.location }
  | { type: 'messageContact'; contact: Td.contact }
  | { type: 'messagePoll'; poll: Td.poll }
  | {
      type: 'messageCall';
      is_video: boolean;
      duration: number;
      discard_reason: Td.CallDiscardReason;
    }
  | { type: string; [key: string]: unknown };

export type SlimChatMember = {
  user_id: number;
  sender_type: 'user' | 'chat';
  joined_date?: number;
  status: 'creator' | 'admin' | 'member' | 'restricted' | 'banned' | 'left';
  custom_title?: string;
};

export type SlimInlineButton = {
  text: string;
  type: string;
  data?: string;
  url?: string;
};

export type SlimReplyMarkup = {
  type: 'inline_keyboard';
  rows: SlimInlineButton[][];
};

// --- Flatten types (from flatten.ts) ---

export type FlatButton = { id: number; text: string; url?: string };

export type FlatMessage = {
  id?: number;
  ids?: number[];
  date: string;
  name: string;
  re?: number;
  re_chat?: number;
  fwd?: string;
  edited?: true;
  text?: string;
  preview?: string;
  content?: string;
  photo?: string | true;
  photos?: (string | true)[];
  video?: string | true;
  videos?: (string | true)[];
  voice?: string;
  doc?: string;
  docs?: string[];
  gif?: string | true;
  audio?: string;
  sticker?: string;
  location?: string;
  contact?: string;
  poll?: string;
  options?: string[];
  pinned?: number;
  duration?: string;
  transcript?: string;
  buttons?: FlatButton[][];
};

export type FlatChat = {
  id: number;
  title: string;
  type: 'user' | 'bot' | 'group' | 'channel';
  unread: number;
  last?: string;
  last_date?: string;
};

export type FlatFindResult = {
  id: number;
  title: string;
  type: 'user' | 'bot' | 'group' | 'channel';
  last_date?: string;
  description?: string;
  link_preview?: string;
  personal_channel?: {
    id: number;
    title: string;
    username: string | null;
    description?: string;
    link_preview?: string;
  };
};

export type FlatCommonGroup = {
  id: number;
  title: string;
  description?: string;
  member_count?: number;
  last_active?: string;
  last_date?: string;
};

export type FlatInfoUser = {
  id: number;
  title: string;
  type: 'user';
  username?: string;
  phone?: string;
  bio?: string;
  link_preview?: string;
  personal_channel?: {
    id: number;
    title: string;
    username: string | null;
    description?: string;
    link_preview?: string;
  };
  is_contact?: boolean;
  is_premium?: boolean;
};

export type FlatInfoBot = {
  id: number;
  title: string;
  type: 'bot';
  username?: string;
  description?: string;
  link_preview?: string;
};

export type FlatInfoGroup = {
  id: number;
  title: string;
  type: 'group';
  description?: string;
  member_count?: number;
};

export type FlatInfoChannel = {
  id: number;
  title: string;
  type: 'channel';
  username?: string;
  description?: string;
  member_count?: number;
};

export type FlatInfoEntity = FlatInfoUser | FlatInfoBot | FlatInfoGroup | FlatInfoChannel;

export type FlatInfo = {
  entity: FlatInfoEntity;
  chat: {
    id: number;
    unread: number;
    last?: string;
    last_date?: string;
  };
  groups?: FlatCommonGroup[];
};

export type CommonGroupInfo = {
  chat: Td.chat;
  description?: string;
  member_count?: number;
  last_active_date?: number;
};

export type FlatMember = {
  user_id: number;
  name?: string;
  username?: string;
  status: 'creator' | 'admin' | 'member' | 'restricted' | 'banned' | 'left';
  custom_title?: string;
  description?: string;
  link_preview?: string;
  personal_channel?: {
    id: number;
    title: string;
    username: string | null;
    description?: string;
    link_preview?: string;
  };
};

export type ContentAny = { type: string; [key: string]: unknown };

// --- Enrich types (from helpers.ts) ---

export type UserProfile = {
  name: string;
  username?: string;
  description?: string;
  link_preview?: string;
  personal_channel?: {
    id: number;
    title: string;
    username: string | null;
    description?: string;
    link_preview?: string;
  };
};

export type EnrichOpts = {
  autoDownload?: boolean;
  autoTranscribe?: boolean;
};
