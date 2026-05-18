/**
 * `telegram-agent info <peer>` — universal entity resolver.
 *
 * Accepts the same peer forms as everything else (`@username`, numeric id,
 * `me`, t.me link, phone number with `+`) and returns an enriched payload:
 *
 *   {
 *     entity,            // serialized profile / chat / channel record
 *     dialog?,           // unreadCount, lastDate, pinned … if you talk to them
 *     fullInfo?,         // expanded data: bio, about, photo, etc.
 *     linkPreview?,      // first URL found in bio + fetched preview title
 *     commonGroups?,     // for users: groups you share with them
 *     memberCount?,      // for channels/groups: participants count
 *   }
 */
import { Api } from 'telegram';

import type { Cmd } from './_shared.js';
import { need, parsePeer, print, serializeDialog, serializeEntity, withClient } from './_shared.js';

function normalizePeerToken(raw: string): string {
  let t = raw.trim();
  const m = /(?:https?:\/\/)?(?:t|telegram)\.me\/(.+)$/i.exec(t);
  if (m) t = m[1];
  return t;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/;

function extractFirstUrlFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return text.match(URL_RE)?.[0];
}

async function fetchLinkPreview(
  client: any,
  url: string,
): Promise<{ url: string; title?: string; description?: string } | undefined> {
  const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const result: any = await client.invoke(new Api.messages.GetWebPagePreview({ message: fullUrl }));
    const wp = result?.webpage ?? result;
    if (wp?.className === 'MessageMediaWebPage' && wp.webpage) {
      const page = wp.webpage;
      return { url: page.url ?? fullUrl, title: page.title, description: page.description };
    }
    if (wp?.title || wp?.description) {
      return { url: wp.url ?? fullUrl, title: wp.title, description: wp.description };
    }
  } catch {
    /* no preview */
  }
  return undefined;
}

async function userFullInfo(client: any, entity: any): Promise<{ fullInfo?: any; commonGroups?: any[] } | undefined> {
  if (!entity || !('firstName' in entity || entity.className?.startsWith?.('User'))) return undefined;
  let fullInfo: any;
  try {
    const inputUser = await client.getInputEntity(entity);
    fullInfo = await client.invoke(new Api.users.GetFullUser({ id: inputUser }));
  } catch {
    return undefined;
  }
  const flat: any = {
    about: fullInfo?.fullUser?.about,
    bio: fullInfo?.fullUser?.bio,
    commonChatsCount: fullInfo?.fullUser?.commonChatsCount,
    blocked: fullInfo?.fullUser?.blocked,
    botInfo: fullInfo?.fullUser?.botInfo,
    personalChannelId: fullInfo?.fullUser?.personalChannelId?.toString?.(),
  };

  let commonGroups: any[] | undefined;
  try {
    const inputUser = await client.getInputEntity(entity);
    const r: any = await client.invoke(
      new Api.messages.GetCommonChats({ userId: inputUser, maxId: 0 as any, limit: 100 }),
    );
    const rawChats = (r.chats ?? []) as any[];

    // For each common group, look up the user's most recent message —
    // gives us a `lastActiveDate` so we can sort by "how recently was
    // this person active here", matching avemeva/kurier's semantics.
    // Bounded concurrency 5 — large `commonChatsCount` (50+) would
    // otherwise burst-fire the API DC pool.
    async function lastActiveAt(chat: any): Promise<number | undefined> {
      try {
        const msgs = await client.getMessages(chat, { fromUser: inputUser, limit: 1 });
        return msgs[0]?.date ?? undefined;
      } catch {
        return undefined;
      }
    }
    const CHUNK = 5;
    const withActivity: any[] = [];
    for (let i = 0; i < rawChats.length; i += CHUNK) {
      const slice = rawChats.slice(i, i + CHUNK);
      const dates = await Promise.all(slice.map((c) => lastActiveAt(c)));
      for (let j = 0; j < slice.length; j++) {
        const c = slice[j];
        withActivity.push({
          id: c.id?.toString?.(),
          title: c.title,
          type: c.className,
          participantsCount: c.participantsCount,
          lastActiveDate: dates[j],
        });
      }
    }

    // Sort by lastActiveDate desc; groups with no detectable activity
    // sink to the bottom in insertion order (i.e. as Telegram returned
    // them).
    withActivity.sort((a, b) => {
      const da = a.lastActiveDate ?? -1;
      const db = b.lastActiveDate ?? -1;
      return db - da;
    });
    commonGroups = withActivity;
  } catch {
    /* no common chats / privacy */
  }

  return { fullInfo: flat, commonGroups };
}

async function channelFullInfo(
  client: any,
  entity: any,
): Promise<{ fullInfo?: any; memberCount?: number } | undefined> {
  // gram.js exposes channelFull on Channel entities. The chat (chat.MegaGroup)
  // path goes through messages.GetFullChat instead.
  if (!entity) return undefined;
  const isChannel = entity.className === 'Channel' || entity.broadcast || entity.megagroup;
  if (!isChannel) return undefined;
  try {
    const inputChannel = await client.getInputEntity(entity);
    const r: any = await client.invoke(new Api.channels.GetFullChannel({ channel: inputChannel }));
    const f = r?.fullChat;
    return {
      fullInfo: {
        about: f?.about,
        participantsCount: f?.participantsCount,
        adminsCount: f?.adminsCount,
        kickedCount: f?.kickedCount,
        canViewParticipants: f?.canViewParticipants,
        slowmodeSeconds: f?.slowmodeSeconds,
        linkedChatId: f?.linkedChatId?.toString?.(),
      },
      memberCount: f?.participantsCount,
    };
  } catch {
    return undefined;
  }
}

export const info: Cmd = async (args, flags) => {
  const raw = need(args, 0, 'peer');
  const peer = normalizePeerToken(raw);
  await withClient(flags, async (client) => {
    const entity = await client.getEntity(parsePeer(peer));

    let dialog: any = null;
    try {
      for await (const d of client.iterDialogs({})) {
        if (d.id?.toString() === entity.id?.toString()) {
          dialog = serializeDialog(d);
          break;
        }
      }
    } catch {
      /* no dialog */
    }

    // Run user / channel enrichment in parallel — they're disjoint paths,
    // and we have a few RPCs to make.
    const [userEnrichment, channelEnrichment] = await Promise.all([
      userFullInfo(client, entity),
      channelFullInfo(client, entity),
    ]);

    const fullInfo = userEnrichment?.fullInfo ?? channelEnrichment?.fullInfo;
    const commonGroups = userEnrichment?.commonGroups;
    const memberCount = channelEnrichment?.memberCount;

    // Pull a preview of the first URL we find in the bio / about text.
    const bioText = fullInfo?.bio ?? fullInfo?.about;
    const firstUrl =
      extractFirstUrlFromText(bioText) ?? (entity?.username ? undefined : extractFirstUrlFromText(entity?.username));
    const linkPreview = firstUrl ? await fetchLinkPreview(client, firstUrl) : undefined;

    const payload: any = {
      entity: serializeEntity(entity),
      dialog,
      fullInfo,
      commonGroups,
      memberCount,
      linkPreview,
    };
    for (const k of Object.keys(payload)) {
      if (payload[k] == null || (Array.isArray(payload[k]) && payload[k].length === 0)) {
        delete payload[k];
      }
    }
    print(payload);
  });
};
