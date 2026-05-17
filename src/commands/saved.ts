/**
 * `saved` — Telegram Premium reaction-tags on Saved Messages.
 *
 *   saved tags                 List tag reactions + custom titles + counts
 *   saved tag-rename           Set/clear the custom title for a tag-emoji
 *   saved default-tags         Server-suggested default emoji set
 *   saved search               Search Saved Messages with optional tag filter
 *   saved dialogs              Forum-style sub-dialogs (per origin peer)
 *   saved history <peer>       Messages in one saved sub-dialog
 *   saved delete-history <peer>  Wipe a saved sub-dialog (destructive)
 *   saved toggle-pin <peer>    Pin/unpin a saved sub-dialog
 */
import { Api } from 'telegram';
import bigInt from 'big-integer';

import type { Cmd, CmdGroup } from './_shared.js';
import {
  withClient,
  inputPeerOf,
  serializeMessage,
  need,
  print,
  ok,
  flagBool,
  flagNum,
  flagStr,
  flagList,
} from './_shared.js';

const tags: Cmd = async (_, flags) => {
  await withClient(flags, async (client) => {
    const result: any = await client.invoke(
      new Api.messages.GetSavedReactionTags({ hash: bigInt(0) as any })
    );
    print(result);
  });
};

const tagRename: Cmd = async (args, flags) => {
  const emoji = need(args, 0, 'emoji');
  const title = args[1];
  await withClient(flags, async (client) => {
    const reaction = new Api.ReactionEmoji({ emoticon: emoji });
    await client.invoke(new Api.messages.UpdateSavedReactionTag({ reaction, title }));
    ok({ emoji, title: title ?? null });
  });
};

const defaultTags: Cmd = async (_, flags) => {
  await withClient(flags, async (client) => {
    const result: any = await client.invoke(
      new Api.messages.GetDefaultTagReactions({ hash: bigInt(0) as any })
    );
    print(result);
  });
};

const search: Cmd = async (_, flags) => {
  await withClient(flags, async (client) => {
    const mePeer = await client.getInputEntity('me');
    const reactions: any[] = [];
    for (const e of flagList(flags, 'tag') ?? []) reactions.push(new Api.ReactionEmoji({ emoticon: e }));
    for (const id of flagList(flags, 'tag-custom') ?? [])
      reactions.push(new Api.ReactionCustomEmoji({ documentId: bigInt(id) }));
    const params: any = {
      peer: mePeer,
      q: flagStr(flags, 'query') ?? '',
      filter: new Api.InputMessagesFilterEmpty(),
      minDate: flagNum(flags, 'since') ?? 0,
      maxDate: flagNum(flags, 'until') ?? 0,
      offsetId: 0,
      addOffset: 0,
      limit: flagNum(flags, 'limit') ?? 50,
      maxId: 0,
      minId: 0,
      hash: bigInt(0) as any,
    };
    if (reactions.length) params.savedReaction = reactions;
    const savedPeer = flagStr(flags, 'saved-peer');
    if (savedPeer) params.savedPeerId = await inputPeerOf(client, savedPeer);
    const result: any = await client.invoke(new Api.messages.Search(params));
    print((result.messages ?? []).map(serializeMessage));
  });
};

const dialogs: Cmd = async (_, flags) => {
  await withClient(flags, async (client) => {
    const result: any = await client.invoke(
      new Api.messages.GetSavedDialogs({
        excludePinned: flagBool(flags, 'exclude-pinned'),
        offsetDate: 0,
        offsetId: 0,
        offsetPeer: new Api.InputPeerEmpty(),
        limit: flagNum(flags, 'limit') ?? 50,
        hash: bigInt(0) as any,
      })
    );
    print(result);
  });
};

const history: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'peer');
  await withClient(flags, async (client) => {
    const inputPeer = await inputPeerOf(client, peer);
    const result: any = await client.invoke(
      new Api.messages.GetSavedHistory({
        peer: inputPeer,
        offsetId: flagNum(flags, 'offset-id') ?? 0,
        offsetDate: 0,
        addOffset: 0,
        limit: flagNum(flags, 'limit') ?? 50,
        maxId: 0,
        minId: 0,
        hash: bigInt(0) as any,
      })
    );
    print((result.messages ?? []).map(serializeMessage));
  });
};

const deleteHistory: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'peer');
  await withClient(flags, async (client) => {
    const inputPeer = await inputPeerOf(client, peer);
    const result: any = await client.invoke(
      new Api.messages.DeleteSavedHistory({
        peer: inputPeer,
        maxId: flagNum(flags, 'max-id') ?? 0,
        minDate: flagNum(flags, 'min-date'),
        maxDate: flagNum(flags, 'max-date'),
      })
    );
    print(result);
  });
};

const togglePin: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'peer');
  await withClient(flags, async (client) => {
    const inputPeer = await inputPeerOf(client, peer);
    await client.invoke(
      new Api.messages.ToggleSavedDialogPin({
        pinned: flagBool(flags, 'pinned'),
        peer: new Api.InputDialogPeer({ peer: inputPeer }),
      })
    );
    ok();
  });
};

export const saved: CmdGroup = {
  tags,
  'tag-rename': tagRename,
  'default-tags': defaultTags,
  search,
  dialogs,
  history,
  'delete-history': deleteHistory,
  'toggle-pin': togglePin,
};
