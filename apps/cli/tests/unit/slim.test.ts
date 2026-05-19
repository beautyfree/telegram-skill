import { describe, expect, test } from 'bun:test';
import type * as Td from 'tdlib-types';
import {
  extractPreview,
  slimChat,
  slimChats,
  slimMember,
  slimMembers,
  slimMessage,
  slimMessages,
  slimUser,
  slimUsers,
} from '../../src/slim';

/** Loose record type for asserting on dynamically-shaped slim content without `any`. */
type Rec = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Factory helpers — complete TDLib objects with all required fields
// ---------------------------------------------------------------------------

function makeFile(overrides: Partial<Td.file> = {}): Td.file {
  return {
    _: 'file',
    id: 1,
    size: 1024,
    expected_size: 1024,
    local: {
      _: 'localFile',
      path: '',
      can_be_downloaded: true,
      can_be_deleted: false,
      is_downloading_active: false,
      is_downloading_completed: false,
      download_offset: 0,
      downloaded_prefix_size: 0,
      downloaded_size: 0,
    },
    remote: {
      _: 'remoteFile',
      id: 'remote-id',
      unique_id: 'unique-id',
      is_uploading_active: false,
      is_uploading_completed: true,
      uploaded_size: 1024,
    },
    ...overrides,
  };
}

function makeUser(overrides: Partial<Td.user> = {}): Td.user {
  return {
    _: 'user',
    id: 123,
    first_name: 'John',
    last_name: 'Doe',
    usernames: undefined,
    phone_number: '+1234567890',
    status: { _: 'userStatusEmpty' },
    profile_photo: undefined,
    accent_color_id: 0,
    background_custom_emoji_id: '0',
    profile_accent_color_id: -1,
    profile_background_custom_emoji_id: '0',
    emoji_status: undefined,
    is_contact: false,
    is_mutual_contact: false,
    is_close_friend: false,
    verification_status: undefined,
    is_premium: false,
    is_support: false,
    restricts_new_chats: false,
    paid_message_star_count: 0,
    have_access: true,
    type: { _: 'userTypeRegular' },
    language_code: '',
    added_to_attachment_menu: false,
    ...overrides,
  };
}

function makeTextContent(overrides: Partial<Td.messageText> = {}): Td.messageText {
  return {
    _: 'messageText',
    text: { _: 'formattedText', text: 'hello', entities: [] },
    link_preview: undefined,
    link_preview_options: undefined,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Td.message> = {}): Td.message {
  return {
    _: 'message',
    id: 1000,
    sender_id: { _: 'messageSenderUser', user_id: 123 },
    chat_id: 456,
    sending_state: undefined,
    scheduling_state: undefined,
    is_outgoing: false,
    is_pinned: false,
    is_from_offline: false,
    can_be_saved: true,
    has_timestamped_media: false,
    is_channel_post: false,
    is_paid_star_suggested_post: false,
    is_paid_ton_suggested_post: false,
    contains_unread_mention: false,
    date: 1700000000,
    edit_date: 0,
    forward_info: undefined,
    interaction_info: undefined,
    unread_reactions: [],
    reply_to: undefined,
    self_destruct_in: 0,
    auto_delete_in: 0,
    via_bot_user_id: 0,
    sender_business_bot_user_id: 0,
    sender_boost_count: 0,
    paid_message_star_count: 0,
    author_signature: '',
    media_album_id: '0',
    effect_id: '0',
    summary_language_code: '',
    content: makeTextContent(),
    reply_markup: undefined,
    ...overrides,
  };
}

function makeChat(overrides: Partial<Td.chat> = {}): Td.chat {
  return {
    _: 'chat',
    id: 456,
    type: { _: 'chatTypePrivate', user_id: 123 },
    title: 'Test Chat',
    photo: undefined,
    permissions: {
      _: 'chatPermissions',
      can_send_basic_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_link_previews: true,
      can_change_info: true,
      can_invite_users: true,
      can_pin_messages: true,
      can_create_topics: true,
    },
    last_message: undefined,
    positions: [],
    chat_lists: [],
    message_sender_id: undefined,
    block_list: undefined,
    has_protected_content: false,
    is_translatable: false,
    is_marked_as_unread: false,
    view_as_topics: false,
    has_scheduled_messages: false,
    can_be_deleted_only_for_self: true,
    can_be_deleted_for_all_users: false,
    can_be_reported: false,
    default_disable_notification: false,
    unread_count: 5,
    last_read_inbox_message_id: 900,
    last_read_outbox_message_id: 800,
    unread_mention_count: 1,
    unread_reaction_count: 0,
    notification_settings: {
      _: 'chatNotificationSettings',
      use_default_mute_for: false,
      mute_for: 0,
      use_default_sound: true,
      sound_id: '0',
      use_default_show_preview: true,
      show_preview: true,
      use_default_mute_stories: false,
      mute_stories: false,
      use_default_story_sound: true,
      story_sound_id: '0',
      use_default_show_story_poster: true,
      show_story_poster: false,
      use_default_disable_pinned_message_notifications: true,
      disable_pinned_message_notifications: false,
      use_default_disable_mention_notifications: true,
      disable_mention_notifications: false,
    },
    available_reactions: { _: 'chatAvailableReactionsAll', max_reaction_count: 3 },
    message_auto_delete_time: 0,
    accent_color_id: 0,
    background_custom_emoji_id: '0',
    profile_accent_color_id: -1,
    profile_background_custom_emoji_id: '0',
    background: undefined,
    action_bar: undefined,
    video_chat: {
      _: 'videoChat',
      group_call_id: 0,
      has_participants: false,
      default_participant_id: undefined,
    },
    pending_join_requests: undefined,
    reply_markup_message_id: 0,
    draft_message: undefined,
    client_data: '',
    ...overrides,
  };
}

function makeChatMember(overrides: Partial<Td.chatMember> = {}): Td.chatMember {
  return {
    _: 'chatMember',
    member_id: { _: 'messageSenderUser', user_id: 42 },
    inviter_user_id: 99,
    joined_chat_date: 1700000000,
    status: { _: 'chatMemberStatusMember', member_until_date: 0 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// slimUser
// ---------------------------------------------------------------------------

describe('slimUser', () => {
  const expectedKeys = [
    'id',
    'first_name',
    'last_name',
    'username',
    'phone_number',
    'is_contact',
    'is_verified',
    'is_premium',
    'is_scam',
    'is_fake',
    'type',
  ].sort();

  const absentKeys = [
    '_',
    'profile_photo',
    'emoji_status',
    'status',
    'restriction_info',
    'have_access',
    'language_code',
    'added_to_attachment_menu',
    'is_mutual_contact',
    'is_support',
    'usernames',
  ];

  test('has exactly the expected keys', () => {
    const result = slimUser(makeUser());
    expect(Object.keys(result).sort()).toEqual(expectedKeys);
  });

  test('drops absent keys', () => {
    const result = slimUser(makeUser());
    for (const key of absentKeys) {
      expect(key in result).toBe(false);
    }
  });

  test('preserves field values', () => {
    const result = slimUser(makeUser({ first_name: 'Alice', is_premium: true }));
    expect(result.first_name).toBe('Alice');
    expect(result.is_premium).toBe(true);
  });

  test('username is null when no usernames', () => {
    const result = slimUser(makeUser({ usernames: undefined }));
    expect(result.username).toBeNull();
  });

  test('username extracts first active username', () => {
    const result = slimUser(
      makeUser({
        usernames: {
          _: 'usernames',
          active_usernames: ['alice', 'alice2'],
          disabled_usernames: [],
          editable_username: 'alice',
          collectible_usernames: [],
        },
      }),
    );
    expect(result.username).toBe('alice');
  });

  test('omits last_name when empty string', () => {
    const result = slimUser(makeUser({ last_name: '' }));
    expect('last_name' in result).toBe(false);
  });

  test('keeps last_name when non-empty', () => {
    const result = slimUser(makeUser({ last_name: 'Smith' }));
    expect(result.last_name).toBe('Smith');
  });

  test('boolean fields default to false', () => {
    const result = slimUser(makeUser());
    expect(result.is_verified).toBe(false);
    expect(result.is_scam).toBe(false);
    expect(result.is_fake).toBe(false);
  });

  test('includes active_user_count for bot with active users', () => {
    const result = slimUser(
      makeUser({
        type: {
          _: 'userTypeBot',
          can_be_edited: false,
          can_join_groups: true,
          can_read_all_group_messages: false,
          is_inline: false,
          inline_query_placeholder: '',
          need_location: false,
          can_connect_to_business: false,
          can_be_added_to_attachment_menu: false,
          has_main_web_app: false,
          active_user_count: 5000,
        },
      }),
    );
    expect(result.active_user_count).toBe(5000);
  });

  test('omits active_user_count for regular users', () => {
    const result = slimUser(makeUser({ type: { _: 'userTypeRegular' } }));
    expect('active_user_count' in result).toBe(false);
  });

  test('includes active_user_count 0 for bots with 0 users', () => {
    const result = slimUser(
      makeUser({
        type: {
          _: 'userTypeBot',
          can_be_edited: false,
          can_join_groups: true,
          can_read_all_group_messages: false,
          is_inline: false,
          inline_query_placeholder: '',
          need_location: false,
          can_connect_to_business: false,
          can_be_added_to_attachment_menu: false,
          has_main_web_app: false,
          active_user_count: 0,
        },
      }),
    );
    expect(result.active_user_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// slimChat
// ---------------------------------------------------------------------------

describe('slimChat', () => {
  const expectedKeysWithMention = [
    'id',
    'type',
    'title',
    'unread_count',
    'last_read_inbox_message_id',
    'unread_mention_count',
  ].sort();

  const absentKeys = [
    '_',
    'photo',
    'permissions',
    'positions',
    'notification_settings',
    'available_reactions',
    'background',
    'theme_name',
    'action_bar',
    'video_chat',
    'pending_join_requests',
    'draft_message',
    'client_data',
    'last_read_outbox_message_id',
  ];

  test('has expected keys (with unread mentions)', () => {
    const result = slimChat(makeChat());
    // last_message is undefined so absent from keys
    expect(Object.keys(result).sort()).toEqual(expectedKeysWithMention);
  });

  test('omits unread_mention_count when 0', () => {
    const result = slimChat(makeChat({ unread_mention_count: 0 }));
    expect('unread_mention_count' in result).toBe(false);
  });

  test('drops absent keys', () => {
    const result = slimChat(makeChat());
    for (const key of absentKeys) {
      expect(key in result).toBe(false);
    }
  });

  test('type is flattened to string for private chat', () => {
    const result = slimChat(makeChat({ type: { _: 'chatTypePrivate', user_id: 1 } }));
    expect(result.type).toBe('user');
  });

  test('type is "group" for basic group', () => {
    const result = slimChat(makeChat({ type: { _: 'chatTypeBasicGroup', basic_group_id: 1 } }));
    expect(result.type).toBe('group');
  });

  test('type is "channel" for supergroup channel', () => {
    const result = slimChat(
      makeChat({ type: { _: 'chatTypeSupergroup', supergroup_id: 1, is_channel: true } }),
    );
    expect(result.type).toBe('channel');
  });

  test('type is "group" for supergroup non-channel', () => {
    const result = slimChat(
      makeChat({ type: { _: 'chatTypeSupergroup', supergroup_id: 1, is_channel: false } }),
    );
    expect(result.type).toBe('group');
  });

  test('type is "user" for secret chat', () => {
    const result = slimChat(
      makeChat({ type: { _: 'chatTypeSecret', secret_chat_id: 1, user_id: 2 } }),
    );
    expect(result.type).toBe('user');
  });

  test('last_message is undefined when chat has none', () => {
    const result = slimChat(makeChat({ last_message: undefined }));
    expect(result.last_message).toBeUndefined();
  });

  test('last_message is compact preview (not full slimMessage)', () => {
    const msg = makeMessage({
      content: makeTextContent({
        text: { _: 'formattedText', text: 'preview text here', entities: [] },
      }),
    });
    const result = slimChat(makeChat({ last_message: msg }));
    expect(result.last_message).toBeDefined();
    expect(result.last_message?.id).toBe(1000);
    expect(result.last_message?.date).toBe(1700000000);
    expect(result.last_message?.text).toBe('preview text here');
    // Should NOT have full message fields
    const lm = result.last_message as Rec;
    expect('content' in lm).toBe(false);
    expect('sender_id' in lm).toBe(false);
    expect('is_outgoing' in lm).toBe(false);
  });

  test('last_message preview truncates long text', () => {
    const longText = 'a'.repeat(200);
    const msg = makeMessage({
      content: makeTextContent({
        text: { _: 'formattedText', text: longText, entities: [] },
      }),
    });
    const result = slimChat(makeChat({ last_message: msg }));
    expect(result.last_message?.text).toBe(`${'a'.repeat(150)}...`);
  });
});

// ---------------------------------------------------------------------------
// slimMessage
// ---------------------------------------------------------------------------

describe('slimMessage', () => {
  const expectedKeys = [
    'id',
    'sender_type',
    'sender_id',
    'chat_id',
    'is_outgoing',
    'date',
    'content',
  ].sort();

  const absentKeys = [
    '_',
    'is_pinned',
    'can_be_saved',
    'interaction_info',
    'unread_reactions',
    'via_bot_user_id',
    'author_signature',
    'effect_id',
  ];

  test('has exactly the expected keys (zero fields omitted)', () => {
    const result = slimMessage(makeMessage());
    expect(Object.keys(result).sort()).toEqual(expectedKeys);
  });

  test('drops absent keys', () => {
    const result = slimMessage(makeMessage());
    for (const key of absentKeys) {
      expect(key in result).toBe(false);
    }
  });

  test('omits reply_markup when message has none', () => {
    const result = slimMessage(makeMessage());
    expect('reply_markup' in result).toBe(false);
  });

  test('includes reply_markup for inline keyboard with callback button', () => {
    const result = slimMessage(
      makeMessage({
        reply_markup: {
          _: 'replyMarkupInlineKeyboard',
          rows: [
            [
              {
                _: 'inlineKeyboardButton',
                text: 'Click me',
                icon_custom_emoji_id: '0',
                style: { _: 'buttonStyleDefault' },
                type: { _: 'inlineKeyboardButtonTypeCallback', data: 'Y2FsbGJhY2s=' },
              },
            ],
          ],
        },
      }),
    );
    expect(result.reply_markup).toBeDefined();
    expect(result.reply_markup?.type).toBe('inline_keyboard');
    expect(result.reply_markup?.rows).toHaveLength(1);
    expect(result.reply_markup?.rows[0]?.[0]?.text).toBe('Click me');
    expect(result.reply_markup?.rows[0]?.[0]?.type).toBe('callback');
    expect(result.reply_markup?.rows[0]?.[0]?.data).toBe('Y2FsbGJhY2s=');
  });

  test('includes reply_markup for inline keyboard with url button', () => {
    const result = slimMessage(
      makeMessage({
        reply_markup: {
          _: 'replyMarkupInlineKeyboard',
          rows: [
            [
              {
                _: 'inlineKeyboardButton',
                text: 'Open link',
                icon_custom_emoji_id: '0',
                style: { _: 'buttonStyleDefault' },
                type: { _: 'inlineKeyboardButtonTypeUrl', url: 'https://example.com' },
              },
            ],
          ],
        },
      }),
    );
    expect(result.reply_markup?.rows[0]?.[0]?.type).toBe('url');
    expect(result.reply_markup?.rows[0]?.[0]?.url).toBe('https://example.com');
  });

  test('omits reply_markup for non-inline keyboard types', () => {
    const result = slimMessage(
      makeMessage({
        reply_markup: {
          _: 'replyMarkupForceReply',
          is_personal: false,
          input_field_placeholder: '',
        } as unknown as Td.ReplyMarkup,
      }),
    );
    expect('reply_markup' in result).toBe(false);
  });

  test('flattens messageSenderUser', () => {
    const result = slimMessage(
      makeMessage({
        sender_id: { _: 'messageSenderUser', user_id: 42 },
      }),
    );
    expect(result.sender_type).toBe('user');
    expect(result.sender_id).toBe(42);
  });

  test('flattens messageSenderChat', () => {
    const result = slimMessage(
      makeMessage({
        sender_id: { _: 'messageSenderChat', chat_id: 99 },
      }),
    );
    expect(result.sender_type).toBe('chat');
    expect(result.sender_id).toBe(99);
  });

  test('omits edit_date when 0', () => {
    const result = slimMessage(makeMessage({ edit_date: 0 }));
    expect('edit_date' in result).toBe(false);
  });

  test('keeps edit_date when non-zero', () => {
    const result = slimMessage(makeMessage({ edit_date: 1700001000 }));
    expect(result.edit_date).toBe(1700001000);
  });

  test('omits reply_to_message_id when no reply_to', () => {
    const result = slimMessage(makeMessage({ reply_to: undefined }));
    expect('reply_to_message_id' in result).toBe(false);
  });

  test('keeps reply_to_message_id when reply_to present', () => {
    const msg = makeMessage({
      reply_to: {
        _: 'messageReplyToMessage',
        chat_id: 456,
        message_id: 500,
        checklist_task_id: 0,
        origin_send_date: 0,
      },
    });
    const result = slimMessage(msg);
    expect(result.reply_to_message_id).toBe(500);
    // Same chat — reply_in_chat_id should be omitted
    expect('reply_in_chat_id' in result).toBe(false);
  });

  test('omits reply_in_chat_id when reply is in same chat', () => {
    const result = slimMessage(
      makeMessage({
        reply_to: {
          _: 'messageReplyToMessage',
          chat_id: 456,
          message_id: 500,
          checklist_task_id: 0,
          origin_send_date: 0,
        },
      }),
    );
    expect('reply_in_chat_id' in result).toBe(false);
  });

  test('omits media_album_id when "0"', () => {
    const result = slimMessage(makeMessage({ media_album_id: '0' }));
    expect('media_album_id' in result).toBe(false);
  });

  test('keeps media_album_id as string when non-zero', () => {
    const result = slimMessage(makeMessage({ media_album_id: '12345' }));
    expect(result.media_album_id).toBe('12345');
  });

  test('removes _ discriminant', () => {
    const result = slimMessage(makeMessage());
    expect('_' in result).toBe(false);
  });

  test('content is recursively slimmed', () => {
    const result = slimMessage(
      makeMessage({
        content: makeTextContent({
          link_preview: {
            _: 'linkPreview',
            url: 'https://example.com',
            display_url: 'example.com',
            site_name: '',
            title: '',
            description: { _: 'formattedText', text: '', entities: [] },
            type: { _: 'linkPreviewTypeArticle' },
          } as unknown as Td.linkPreview,
        }),
      }),
    );
    expect(result.content.type).toBe('messageText');
    expect('link_preview' in result.content).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// slimContent — one test per media type
// ---------------------------------------------------------------------------

describe('slimContent', () => {
  // Helper: run slimMessage and return just the content
  function slimContentVia(content: Td.MessageContent) {
    return slimMessage(makeMessage({ content })).content;
  }

  test('messageText: flattens formattedText, drops link_preview', () => {
    const content = slimContentVia({
      _: 'messageText',
      text: { _: 'formattedText', text: 'hi', entities: [] },
      link_preview: {
        _: 'linkPreview',
        url: 'https://example.com',
        display_url: 'example.com',
        site_name: '',
        title: '',
        description: { _: 'formattedText', text: '', entities: [] },
        type: { _: 'linkPreviewTypeArticle' },
      } as unknown as Td.linkPreview,
    } satisfies Td.messageText);

    expect(content.type).toBe('messageText');
    // text is now a plain string, not nested formattedText
    expect((content as Rec).text).toBe('hi');
    expect('link_preview' in content).toBe(false);
    expect(Object.keys(content).sort()).toEqual(['text', 'type']);
  });

  test('messageText: renders entities as inline markdown', () => {
    const content = slimContentVia({
      _: 'messageText',
      text: {
        _: 'formattedText',
        text: 'bold mention link',
        entities: [
          { _: 'textEntity', offset: 0, length: 4, type: { _: 'textEntityTypeBold' } },
          { _: 'textEntity', offset: 5, length: 7, type: { _: 'textEntityTypeMention' } },
          {
            _: 'textEntity',
            offset: 13,
            length: 4,
            type: { _: 'textEntityTypeTextUrl', url: 'https://x.com' },
          },
          { _: 'textEntity', offset: 0, length: 4, type: { _: 'textEntityTypeItalic' } },
        ],
      },
      link_preview: undefined,
    } satisfies Td.messageText);

    expect(content).toEqual({
      type: 'messageText',
      text: '**__bold**__ mention [link](https://x.com)',
    });
    expect('entities' in content).toBe(false);
  });

  test('messageText: no entities returns plain text', () => {
    const content = slimContentVia({
      _: 'messageText',
      text: {
        _: 'formattedText',
        text: 'bold italic',
        entities: [],
      },
      link_preview: undefined,
    } satisfies Td.messageText);

    expect(content).toEqual({ type: 'messageText', text: 'bold italic' });
  });

  test('messagePhoto: keeps only largest size as single object, flattens caption', () => {
    const content = slimContentVia({
      _: 'messagePhoto',
      photo: {
        _: 'photo',
        has_stickers: true,
        minithumbnail: { _: 'minithumbnail', width: 10, height: 10, data: 'abc' },
        sizes: [
          {
            _: 'photoSize',
            type: 's',
            photo: makeFile({ id: 100 }),
            width: 320,
            height: 240,
            progressive_sizes: [],
          },
          {
            _: 'photoSize',
            type: 'm',
            photo: makeFile({ id: 200 }),
            width: 640,
            height: 480,
            progressive_sizes: [],
          },
        ],
      },
      caption: { _: 'formattedText', text: 'a photo', entities: [] },
      show_caption_above_media: false,
      has_spoiler: true,
      is_secret: false,
    } satisfies Td.messagePhoto);

    expect(content.type).toBe('messagePhoto');
    const c = content as Rec;
    // Single largest photo, not array
    expect(c.photo).toEqual({
      width: 640,
      height: 480,
      file: { id: 200, size: 1024, downloaded: false },
    });
    // Caption is now a plain string
    expect(c.caption).toBe('a photo');
    // Dropped fields
    expect('minithumbnail' in c).toBe(false);
    expect('has_stickers' in c).toBe(false);
    expect('has_spoiler' in c).toBe(false);
    expect('is_secret' in c).toBe(false);
    expect(Object.keys(c).sort()).toEqual(['caption', 'photo', 'type']);
  });

  test('messagePhoto: omits caption when empty', () => {
    const content = slimContentVia({
      _: 'messagePhoto',
      photo: {
        _: 'photo',
        has_stickers: false,
        minithumbnail: undefined,
        sizes: [
          {
            _: 'photoSize',
            type: 's',
            photo: makeFile({ id: 100 }),
            width: 320,
            height: 240,
            progressive_sizes: [],
          },
        ],
      },
      caption: { _: 'formattedText', text: '', entities: [] },
      show_caption_above_media: false,
      has_spoiler: false,
      is_secret: false,
    } satisfies Td.messagePhoto);

    const c = content as Rec;
    expect('caption' in c).toBe(false);
  });

  test('messageVideo: extracts from nested video object, drops file/thumbnail', () => {
    const content = slimContentVia({
      _: 'messageVideo',
      video: {
        _: 'video',
        duration: 120,
        width: 1920,
        height: 1080,
        file_name: 'clip.mp4',
        mime_type: 'video/mp4',
        has_stickers: false,
        supports_streaming: true,
        minithumbnail: undefined,
        thumbnail: undefined,
        video: makeFile(),
      },
      alternative_videos: [],
      storyboards: [],
      start_timestamp: 0,
      caption: { _: 'formattedText', text: 'a video', entities: [] },
      show_caption_above_media: false,
      has_spoiler: false,
      is_secret: false,
    } satisfies Td.messageVideo);

    expect(content.type).toBe('messageVideo');
    const c = content as Rec;
    expect(c.file_name).toBe('clip.mp4');
    expect(c.mime_type).toBe('video/mp4');
    expect(c.duration).toBe(120);
    expect(c.width).toBe(1920);
    expect(c.height).toBe(1080);
    expect(c.caption).toBe('a video');
    // No nested video object, no thumbnail, no file
    expect('video' in c).toBe(false);
    expect('thumbnail' in c).toBe(false);
    expect('has_spoiler' in c).toBe(false);
    expect(Object.keys(c).sort()).toEqual([
      'caption',
      'duration',
      'file',
      'file_name',
      'height',
      'mime_type',
      'type',
      'width',
    ]);
  });

  test('messageDocument: extracts from nested document object', () => {
    const content = slimContentVia({
      _: 'messageDocument',
      document: {
        _: 'document',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        minithumbnail: undefined,
        thumbnail: undefined,
        document: makeFile(),
      },
      caption: { _: 'formattedText', text: 'a doc', entities: [] },
    } satisfies Td.messageDocument);

    expect(content.type).toBe('messageDocument');
    const c = content as Rec;
    expect(c.file_name).toBe('report.pdf');
    expect(c.mime_type).toBe('application/pdf');
    expect(c.caption).toBe('a doc');
    expect('document' in c).toBe(false);
    expect(Object.keys(c).sort()).toEqual(['caption', 'file', 'file_name', 'mime_type', 'type']);
  });

  test('messageSticker: keeps only emoji', () => {
    const content = slimContentVia({
      _: 'messageSticker',
      sticker: {
        _: 'sticker',
        id: '1',
        set_id: '1',
        width: 512,
        height: 512,
        emoji: '😀',
        format: { _: 'stickerFormatWebp' },
        full_type: { _: 'stickerFullTypeRegular', premium_animation: undefined },
        thumbnail: undefined,
        sticker: makeFile(),
      },
      is_premium: false,
    } satisfies Td.messageSticker);

    expect(content.type).toBe('messageSticker');
    const c = content as Rec;
    expect(c.emoji).toBe('😀');
    expect('sticker' in c).toBe(false);
    expect('is_premium' in c).toBe(false);
    expect(Object.keys(c).sort()).toEqual(['emoji', 'type']);
  });

  test('messageVoiceNote: extracts from nested voice_note, flattens caption', () => {
    const content = slimContentVia({
      _: 'messageVoiceNote',
      voice_note: {
        _: 'voiceNote',
        duration: 15,
        waveform: 'AAAA',
        mime_type: 'audio/ogg',
        speech_recognition_result: undefined,
        voice: makeFile(),
      },
      caption: { _: 'formattedText', text: '', entities: [] },
      is_listened: true,
    } satisfies Td.messageVoiceNote);

    expect(content.type).toBe('messageVoiceNote');
    const c = content as Rec;
    expect(c.duration).toBe(15);
    expect(c.mime_type).toBe('audio/ogg');
    // Empty caption is omitted
    expect('caption' in c).toBe(false);
    expect('voice_note' in c).toBe(false);
    expect('is_listened' in c).toBe(false);
    expect(Object.keys(c).sort()).toEqual(['duration', 'file', 'mime_type', 'type']);
  });

  test('messageVideoNote: extracts duration, length', () => {
    const content = slimContentVia({
      _: 'messageVideoNote',
      video_note: {
        _: 'videoNote',
        duration: 30,
        waveform: '',
        length: 240,
        minithumbnail: undefined,
        thumbnail: undefined,
        speech_recognition_result: undefined,
        video: makeFile(),
      },
      is_viewed: false,
      is_secret: false,
    } satisfies Td.messageVideoNote);

    expect(content.type).toBe('messageVideoNote');
    const c = content as Rec;
    expect(c.duration).toBe(30);
    expect(c.width).toBe(240);
    expect(c.height).toBe(240);
    expect('video_note' in c).toBe(false);
    expect('is_viewed' in c).toBe(false);
    expect('is_secret' in c).toBe(false);
    expect(Object.keys(c).sort()).toEqual(['duration', 'file', 'height', 'type', 'width']);
  });

  test('messageCall: keeps is_video, duration, discard_reason', () => {
    const content = slimContentVia({
      _: 'messageCall',
      is_video: true,
      discard_reason: { _: 'callDiscardReasonHungUp' },
      duration: 300,
    } satisfies Td.messageCall);

    expect(content.type).toBe('messageCall');
    const c = content as Rec;
    expect(c.is_video).toBe(true);
    expect(c.duration).toBe(300);
    expect((c.discard_reason as Rec)._).toBe('callDiscardReasonHungUp');
    expect(Object.keys(c).sort()).toEqual(['discard_reason', 'duration', 'is_video', 'type']);
  });

  test('service message (messageChatChangeTitle): passes through unchanged', () => {
    const original: Td.messageChatChangeTitle = {
      _: 'messageChatChangeTitle',
      title: 'New Title',
    };
    const content = slimContentVia(original);

    expect(content.type).toBe('messageChatChangeTitle');
    expect((content as Rec).title).toBe('New Title');
  });

  test('messageAnimatedEmoji: outputs type and emoji', () => {
    const content = slimContentVia({
      _: 'messageAnimatedEmoji',
      animated_emoji: {
        _: 'animatedEmoji',
        sticker: {
          _: 'sticker',
          id: '1',
          set_id: '1',
          width: 512,
          height: 512,
          emoji: '🐸',
          format: { _: 'stickerFormatTgs' },
          full_type: { _: 'stickerFullTypeRegular', premium_animation: undefined },
          thumbnail: undefined,
          sticker: makeFile(),
        },
        sticker_width: 512,
        sticker_height: 512,
        fitzpatrick_type: 0,
        sound: undefined,
      },
      emoji: '🐸',
    } satisfies Td.messageAnimatedEmoji);

    expect(content.type).toBe('animatedemoji');
    const c = content as Rec;
    expect(c.emoji).toBe('🐸');
    expect(Object.keys(c).sort()).toEqual(['emoji', 'type']);
  });
});

// ---------------------------------------------------------------------------
// extractPreview
// ---------------------------------------------------------------------------

describe('extractPreview', () => {
  test('extracts text from messageText', () => {
    const msg = makeMessage({
      content: makeTextContent({
        text: { _: 'formattedText', text: 'hello world', entities: [] },
      }),
    });
    expect(extractPreview(msg)).toBe('hello world');
  });

  test('extracts caption from messagePhoto', () => {
    const msg = makeMessage({
      content: {
        _: 'messagePhoto',
        photo: {
          _: 'photo',
          has_stickers: false,
          minithumbnail: undefined,
          sizes: [
            {
              _: 'photoSize',
              type: 's',
              photo: makeFile({ id: 100 }),
              width: 320,
              height: 240,
              progressive_sizes: [],
            },
          ],
        },
        caption: { _: 'formattedText', text: 'photo caption', entities: [] },
        show_caption_above_media: false,
        has_spoiler: false,
        is_secret: false,
      } satisfies Td.messagePhoto,
    });
    expect(extractPreview(msg)).toBe('photo caption');
  });

  test('returns emoji for messageSticker', () => {
    const msg = makeMessage({
      content: {
        _: 'messageSticker',
        sticker: {
          _: 'sticker',
          id: '1',
          set_id: '1',
          width: 512,
          height: 512,
          emoji: '😀',
          format: { _: 'stickerFormatWebp' },
          full_type: { _: 'stickerFullTypeRegular', premium_animation: undefined },
          thumbnail: undefined,
          sticker: makeFile(),
        },
        is_premium: false,
      } satisfies Td.messageSticker,
    });
    expect(extractPreview(msg)).toBe('😀');
  });

  test('truncates at maxLength', () => {
    const longText = 'x'.repeat(200);
    const msg = makeMessage({
      content: makeTextContent({
        text: { _: 'formattedText', text: longText, entities: [] },
      }),
    });
    expect(extractPreview(msg, 50)).toBe(`${'x'.repeat(50)}...`);
  });

  test('returns emoji for messageAnimatedEmoji', () => {
    const msg = makeMessage({
      content: {
        _: 'messageAnimatedEmoji',
        animated_emoji: {
          _: 'animatedEmoji',
          sticker_width: 512,
          sticker_height: 512,
          fitzpatrick_type: 0,
        },
        emoji: '🐸',
      } as unknown as Td.messageAnimatedEmoji,
    });
    expect(extractPreview(msg)).toBe('🐸');
  });

  test('returns undefined for unknown content types', () => {
    const msg = makeMessage({
      content: {
        _: 'messageLocation',
        location: { _: 'location', latitude: 0, longitude: 0, horizontal_accuracy: 0 },
      } as unknown as Td.MessageContent,
    });
    expect(extractPreview(msg)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// slimMember
// ---------------------------------------------------------------------------

describe('slimMember', () => {
  test('flattens messageSenderUser to user_id + sender_type', () => {
    const result = slimMember(
      makeChatMember({
        member_id: { _: 'messageSenderUser', user_id: 42 },
      }),
    );
    expect(result.user_id).toBe(42);
    expect(result.sender_type).toBe('user');
  });

  test('flattens messageSenderChat to chat_id + sender_type', () => {
    const result = slimMember(
      makeChatMember({
        member_id: { _: 'messageSenderChat', chat_id: 99 },
      }),
    );
    expect(result.user_id).toBe(99);
    expect(result.sender_type).toBe('chat');
  });

  test('maps status to flat string', () => {
    expect(
      slimMember(
        makeChatMember({
          status: {
            _: 'chatMemberStatusCreator',
            is_anonymous: false,
            is_member: true,
            custom_title: '',
          },
        }),
      ).status,
    ).toBe('creator');
    expect(
      slimMember(
        makeChatMember({
          status: {
            _: 'chatMemberStatusAdministrator',
            can_be_edited: false,
            custom_title: '',
            rights: {
              _: 'chatAdministratorRights',
              can_manage_chat: false,
              can_change_info: false,
              can_post_messages: false,
              can_edit_messages: false,
              can_delete_messages: false,
              can_invite_users: false,
              can_restrict_members: false,
              can_pin_messages: false,
              can_manage_topics: false,
              can_promote_members: false,
              can_manage_video_chats: false,
              can_post_stories: false,
              can_edit_stories: false,
              can_delete_stories: false,
              can_manage_direct_messages: false,
              is_anonymous: false,
            },
          },
        }),
      ).status,
    ).toBe('admin');
    expect(
      slimMember(makeChatMember({ status: { _: 'chatMemberStatusMember', member_until_date: 0 } }))
        .status,
    ).toBe('member');
    expect(slimMember(makeChatMember({ status: { _: 'chatMemberStatusLeft' } })).status).toBe(
      'left',
    );
  });

  test('omits joined_date when 0', () => {
    const result = slimMember(makeChatMember({ joined_chat_date: 0 }));
    expect('joined_date' in result).toBe(false);
  });

  test('keeps joined_date when non-zero', () => {
    const result = slimMember(makeChatMember({ joined_chat_date: 1700000000 }));
    expect(result.joined_date).toBe(1700000000);
  });

  test('extracts custom_title from creator status', () => {
    const result = slimMember(
      makeChatMember({
        status: {
          _: 'chatMemberStatusCreator',
          is_anonymous: false,
          is_member: true,
          custom_title: 'Founder',
        },
      }),
    );
    expect(result.custom_title).toBe('Founder');
  });

  test('extracts custom_title from admin status', () => {
    const result = slimMember(
      makeChatMember({
        status: {
          _: 'chatMemberStatusAdministrator',
          can_be_edited: false,
          custom_title: 'Moderator',
          rights: {
            _: 'chatAdministratorRights',
            can_manage_chat: false,
            can_change_info: false,
            can_post_messages: false,
            can_edit_messages: false,
            can_delete_messages: false,
            can_invite_users: false,
            can_restrict_members: false,
            can_pin_messages: false,
            can_manage_topics: false,
            can_promote_members: false,
            can_manage_video_chats: false,
            can_post_stories: false,
            can_edit_stories: false,
            can_delete_stories: false,
            can_manage_direct_messages: false,
            is_anonymous: false,
          },
        },
      }),
    );
    expect(result.custom_title).toBe('Moderator');
  });

  test('omits custom_title when empty', () => {
    const result = slimMember(
      makeChatMember({
        status: {
          _: 'chatMemberStatusCreator',
          is_anonymous: false,
          is_member: true,
          custom_title: '',
        },
      }),
    );
    expect('custom_title' in result).toBe(false);
  });

  test('omits custom_title for non-admin statuses', () => {
    const result = slimMember(
      makeChatMember({
        status: { _: 'chatMemberStatusMember', member_until_date: 0 },
      }),
    );
    expect('custom_title' in result).toBe(false);
  });

  test('drops _ discriminant', () => {
    const result = slimMember(makeChatMember());
    expect('_' in result).toBe(false);
  });

  test('drops inviter_user_id', () => {
    const result = slimMember(makeChatMember({ inviter_user_id: 999 }));
    expect('inviter_user_id' in result).toBe(false);
  });

  test('drops rights object from admin status', () => {
    const result = slimMember(
      makeChatMember({
        status: {
          _: 'chatMemberStatusAdministrator',
          can_be_edited: false,
          custom_title: '',
          rights: {
            _: 'chatAdministratorRights',
            can_manage_chat: true,
            can_change_info: true,
            can_post_messages: false,
            can_edit_messages: false,
            can_delete_messages: true,
            can_invite_users: true,
            can_restrict_members: true,
            can_pin_messages: true,
            can_manage_topics: false,
            can_promote_members: false,
            can_manage_video_chats: false,
            can_post_stories: false,
            can_edit_stories: false,
            can_delete_stories: false,
            can_manage_direct_messages: false,
            is_anonymous: false,
          },
        },
      }),
    );
    expect(result.status).toBe('admin');
    // The full rights object should not leak through
    expect('rights' in result).toBe(false);
    expect('can_be_edited' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Array wrappers
// ---------------------------------------------------------------------------

describe('array wrappers', () => {
  test('slimUsers maps correctly', () => {
    const users = [makeUser({ id: 1 }), makeUser({ id: 2 })];
    const result = slimUsers(users);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(1);
    expect(result[1]?.id).toBe(2);
    // Each result is slim
    expect('profile_photo' in (result[0] as Rec)).toBe(false);
  });

  test('slimUsers: empty array returns empty', () => {
    expect(slimUsers([])).toEqual([]);
  });

  test('slimChats maps correctly', () => {
    const chats = [makeChat({ id: 10 }), makeChat({ id: 20 })];
    const result = slimChats(chats);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(10);
    expect(result[1]?.id).toBe(20);
    expect('photo' in (result[0] as Rec)).toBe(false);
  });

  test('slimChats: empty array returns empty', () => {
    expect(slimChats([])).toEqual([]);
  });

  test('slimMessages maps correctly', () => {
    const msgs = [makeMessage({ id: 100 }), makeMessage({ id: 200 })];
    const result = slimMessages(msgs);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(100);
    expect(result[1]?.id).toBe(200);
    expect('is_pinned' in (result[0] as Rec)).toBe(false);
  });

  test('slimMessages: empty array returns empty', () => {
    expect(slimMessages([])).toEqual([]);
  });

  test('slimMembers maps correctly', () => {
    const members = [
      makeChatMember({ joined_chat_date: 1000 }),
      makeChatMember({ joined_chat_date: 2000 }),
    ];
    const result = slimMembers(members);
    expect(result).toHaveLength(2);
    expect(result[0]?.joined_date).toBe(1000);
    expect(result[1]?.joined_date).toBe(2000);
    expect('inviter_user_id' in (result[0] as Rec)).toBe(false);
  });

  test('slimMembers: empty array returns empty', () => {
    expect(slimMembers([])).toEqual([]);
  });
});
