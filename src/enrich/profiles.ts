/**
 * Profile enrichment for member lists.
 *
 * `chats members` returns bare User/Chat entities — useful for ids and
 * usernames, but agents often need `bio` / `about` / role to triage. We
 * fan out `users.GetFullUser` calls in parallel (bounded) for each
 * unique user id and merge `bio` + `personalChannelId` into the
 * serialized output.
 */
import { Api } from 'telegram';

type Client = any;

export interface ProfileExtras {
  bio?: string;
  about?: string;
  personalChannelId?: string;
  commonChatsCount?: number;
  isBlocked?: boolean;
}

export async function enrichUserExtras(client: Client, entity: any): Promise<ProfileExtras | null> {
  // Only users have bio. Skip everything else upfront.
  if (!entity) return null;
  const isUser = entity.className?.startsWith?.('User') || 'firstName' in entity;
  if (!isUser) return null;
  try {
    const inputUser = await client.getInputEntity(entity);
    const r: any = await client.invoke(new Api.users.GetFullUser({ id: inputUser }));
    const full = r?.fullUser;
    if (!full) return null;
    const out: ProfileExtras = {};
    if (full.about) out.about = full.about;
    if (full.bio) out.bio = full.bio;
    if (full.personalChannelId) out.personalChannelId = full.personalChannelId.toString();
    if (typeof full.commonChatsCount === 'number') out.commonChatsCount = full.commonChatsCount;
    if (typeof full.blocked === 'boolean') out.isBlocked = full.blocked;
    return out;
  } catch {
    return null;
  }
}

/**
 * Walk an array of serialized entities and attach `.profile` to each
 * user-like one. Mutates in place; bounded parallelism so we don't
 * hammer the API DC pool when a group has 1000 members. Failures are
 * silent (no `.profile` field on that row).
 */
export async function enrichMemberList(
  client: Client,
  rawEntities: any[],
  concurrency = 8,
): Promise<void> {
  for (let i = 0; i < rawEntities.length; i += concurrency) {
    const slice = rawEntities.slice(i, i + concurrency);
    const profiles = await Promise.all(slice.map((e) => enrichUserExtras(client, e)));
    for (let j = 0; j < slice.length; j++) {
      if (profiles[j]) slice[j].profile = profiles[j];
    }
  }
}
