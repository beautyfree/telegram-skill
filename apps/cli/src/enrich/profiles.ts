/**
 * User profile enrichment — bio, link previews, personal channels.
 */

import type { TelegramClient } from '@tg/protocol';
import type * as Td from 'tdlib-types';
import type { FlatMember, SlimChatMember, UserProfile } from '../types';

// --- URL extraction ---

export const URL_RE = /https?:\/\/[^\s<>"')\]]+/;

export function extractFirstUrlFromText(text: string): string | undefined {
  return text.match(URL_RE)?.[0];
}

export function extractFirstUrl(fullInfo: Td.userFullInfo): string | undefined {
  const entities = fullInfo.bio?.entities;
  if (entities?.length) {
    for (const e of entities) {
      if (e.type._ === 'textEntityTypeTextUrl') return e.type.url;
      if (e.type._ === 'textEntityTypeUrl' && fullInfo.bio?.text) {
        return fullInfo.bio.text.slice(e.offset, e.offset + e.length);
      }
    }
  }
  if (fullInfo.bio?.text) return extractFirstUrlFromText(fullInfo.bio.text);
  return undefined;
}

// --- Link preview ---

export async function fetchLinkPreview(
  client: TelegramClient,
  url: string,
): Promise<string | undefined> {
  const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const preview = await client.invoke({
      _: 'getLinkPreview',
      text: { _: 'formattedText', text: fullUrl, entities: [] },
    });
    const parts = [preview.title, preview.description?.text].filter(Boolean);
    return parts.length ? parts.join(' — ') : undefined;
  } catch {
    return undefined;
  }
}

// --- User profile enrichment ---

/** Fetch enriched profile for a single user: name, username, bio, personal channel. */
export async function enrichUserProfile(
  client: TelegramClient,
  userId: number,
): Promise<UserProfile | undefined> {
  try {
    const [user, fullInfo] = await Promise.all([
      client.invoke({ _: 'getUser', user_id: userId }),
      client.invoke({ _: 'getUserFullInfo', user_id: userId }).catch(() => undefined),
    ]);

    const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
    const username = user.usernames?.active_usernames?.[0];

    let description: string | undefined;
    let link_preview: string | undefined;
    if (fullInfo) {
      if (user.type._ === 'userTypeBot') {
        description = fullInfo.bot_info?.short_description || undefined;
      } else {
        description = fullInfo.bio?.text || undefined;
      }
      const firstUrl = extractFirstUrl(fullInfo);
      if (firstUrl) link_preview = await fetchLinkPreview(client, firstUrl);
    }

    let personal_channel: UserProfile['personal_channel'];
    if (fullInfo?.personal_chat_id) {
      try {
        const pc = await client.invoke({ _: 'getChat', chat_id: fullInfo.personal_chat_id });
        let pcUsername: string | null = null;
        let pcDesc: string | undefined;
        let pcLinkPreview: string | undefined;
        if (pc.type._ === 'chatTypeSupergroup') {
          const [sg, sgFull] = await Promise.all([
            client
              .invoke({ _: 'getSupergroup', supergroup_id: pc.type.supergroup_id })
              .catch(() => undefined),
            client
              .invoke({ _: 'getSupergroupFullInfo', supergroup_id: pc.type.supergroup_id })
              .catch(() => undefined),
          ]);
          pcUsername = (sg as Td.supergroup | undefined)?.usernames?.active_usernames?.[0] ?? null;
          pcDesc = (sgFull as Td.supergroupFullInfo | undefined)?.description || undefined;
          const pcUrl = pcDesc ? extractFirstUrlFromText(pcDesc) : undefined;
          if (pcUrl) pcLinkPreview = await fetchLinkPreview(client, pcUrl);
        }
        personal_channel = {
          id: pc.id,
          title: pc.title,
          username: pcUsername,
          description: pcDesc,
          link_preview: pcLinkPreview,
        };
      } catch {
        // personal channel not accessible
      }
    }

    return { name, username, description, link_preview, personal_channel };
  } catch {
    return undefined;
  }
}

/** Enrich slim members into flat members with user profile data. */
export async function enrichMembers(
  client: TelegramClient,
  members: SlimChatMember[],
): Promise<FlatMember[]> {
  const results: FlatMember[] = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < members.length; i += CONCURRENCY) {
    const batch = members.slice(i, i + CONCURRENCY);
    const enriched = await Promise.all(
      batch.map(async (m): Promise<FlatMember> => {
        const base: FlatMember = {
          user_id: m.user_id,
          status: m.status,
          custom_title: m.custom_title,
        };
        if (m.sender_type !== 'user') return base;
        const profile = await enrichUserProfile(client, m.user_id);
        if (profile) {
          base.name = profile.name;
          base.username = profile.username;
          base.description = profile.description;
          base.link_preview = profile.link_preview;
          base.personal_channel = profile.personal_channel;
        }
        return base;
      }),
    );
    results.push(...enriched);
  }
  return results;
}
