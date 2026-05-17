/**
 * `action` command group — every mutating verb.
 *
 *   action send / edit / delete / forward
 *   action pin / unpin
 *   action react / mark-read
 *   action click            (press an inline-keyboard button)
 *
 * `send` and `edit` accept the body either positionally, via `--stdin`, or
 * `--file <path>`. `--md` / `--html` switch parse mode; default is plain
 * text (no implicit markdown).
 */
import { Api } from 'telegram';
import bigInt from 'big-integer';

import type { Cmd, CmdGroup } from './_shared.js';
import {
  parsePeer,
  withClient,
  inputPeerOf,
  serializeMessage,
  need,
  print,
  ok,
  fail,
  readMessageBody,
  collectIds,
  flagBool,
  flagNum,
  flagStr,
  flagList,
} from './_shared.js';

function parseModeOf(flags: any): 'md' | 'html' | undefined {
  if (flagBool(flags, 'md')) return 'md';
  if (flagBool(flags, 'html')) return 'html';
  const explicit = flagStr(flags, 'parse-mode');
  if (explicit === 'markdown' || explicit === 'md') return 'md';
  if (explicit === 'html') return 'html';
  return undefined;
}

const send: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  const text = await readMessageBody(args[1], flags);
  await withClient(flags, async (client) => {
    const msg = await client.sendMessage(parsePeer(peer), {
      message: text,
      replyTo: flagNum(flags, 'reply-to'),
      silent: flagBool(flags, 'silent'),
      parseMode: parseModeOf(flags) as any,
      linkPreview: flagBool(flags, 'no-preview') ? false : undefined,
    } as any);
    print(serializeMessage(msg));
  });
};

const edit: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  const id = Number(need(args, 1, 'messageId'));
  const text = await readMessageBody(args[2], flags);
  await withClient(flags, async (client) => {
    const msg = await client.editMessage(parsePeer(peer), {
      message: id,
      text,
      parseMode: parseModeOf(flags) as any,
    });
    print(serializeMessage(msg));
  });
};

const del: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  const ids = collectIds(args.slice(1));
  if (ids.length === 0) fail('Provide at least one message id');
  await withClient(flags, async (client) => {
    await client.deleteMessages(parsePeer(peer), ids, { revoke: flagBool(flags, 'revoke') ?? true });
    ok({ deleted: ids.length });
  });
};

/**
 * Two forms supported:
 *   action forward <from> <to> <id...>
 *   action forward --from <peer> --to <peer> --ids 1,2,3
 */
const forward: Cmd = async (args, flags) => {
  const from = flagStr(flags, 'from') ?? args[0];
  const to = flagStr(flags, 'to') ?? args[1];
  const ids =
    flagList(flags, 'ids')?.map((n) => Number(n)) ??
    collectIds(args.slice(2));
  if (!from || !to || ids.length === 0) {
    fail('forward needs <from> <to> <id...> (or --from/--to/--ids)');
  }
  await withClient(flags, async (client) => {
    const res = await client.forwardMessages(parsePeer(to), {
      fromPeer: parsePeer(from),
      messages: ids,
      silent: flagBool(flags, 'silent'),
    });
    print(Array.isArray(res) ? res.map(serializeMessage) : serializeMessage(res));
  });
};

const pin: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  const id = Number(need(args, 1, 'messageId'));
  await withClient(flags, async (client) => {
    await client.pinMessage(parsePeer(peer), id, {
      notify: flagBool(flags, 'notify'),
      pmOneSide: flagBool(flags, 'pm-one-side'),
    } as any);
    ok();
  });
};

const unpin: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  if (flagBool(flags, 'all')) {
    await withClient(flags, async (client) => {
      const inputPeer = await inputPeerOf(client, peer);
      await client.invoke(new Api.messages.UnpinAllMessages({ peer: inputPeer }));
      ok({ unpinned: 'all' });
    });
    return;
  }
  const id = Number(need(args, 1, 'messageId'));
  await withClient(flags, async (client) => {
    await client.unpinMessage(parsePeer(peer), id);
    ok();
  });
};

/**
 * `action react <chat> <msgId> <emoji>` — add (or with --remove, drop) a
 * reaction. Passing no emoji clears all reactions, matching gram.js.
 */
const react: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  const id = Number(need(args, 1, 'messageId'));
  const targetEmoji = args[2];
  const remove = flagBool(flags, 'remove') ?? false;
  await withClient(flags, async (client) => {
    const inputPeer = await inputPeerOf(client, peer);

    let reaction: any[] = [];
    if (remove) {
      // Read existing reactions, drop the targeted one, send the rest back.
      const [m] = await client.getMessages(parsePeer(peer), { ids: [id] });
      const current = ((m as any)?.reactions?.results ?? []) as any[];
      for (const r of current) {
        const e = r.reaction?.emoticon;
        if (e !== targetEmoji) reaction.push(r.reaction);
      }
    } else if (targetEmoji) {
      reaction.push(new Api.ReactionEmoji({ emoticon: targetEmoji }));
      for (const cid of flagList(flags, 'custom-emoji-ids') ?? [])
        reaction.push(new Api.ReactionCustomEmoji({ documentId: bigInt(cid) }));
    }

    await client.invoke(
      new Api.messages.SendReaction({
        peer: inputPeer,
        msgId: id,
        reaction,
        big: flagBool(flags, 'big'),
        addToRecent: flagBool(flags, 'add-to-recent'),
      })
    );
    ok();
  });
};

const markRead: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  await withClient(flags, async (client) => {
    await client.markAsRead(parsePeer(peer), flagNum(flags, 'max-id'));
    ok();
  });
};

/**
 * `action click <chat> <msgId> <button>` — press an inline-keyboard button.
 * The button can be referenced by its 1-based index across the keyboard
 * (left-to-right, top-to-bottom), or by an exact text-match against the
 * button label. For callback buttons gramjs invokes
 * `messages.GetBotCallbackAnswer`; for URL buttons it just returns the URL.
 */
const click: Cmd = async (args, flags) => {
  const peer = need(args, 0, 'chat');
  const id = Number(need(args, 1, 'messageId'));
  const selector = need(args, 2, 'button');
  await withClient(flags, async (client) => {
    const [message] = await client.getMessages(parsePeer(peer), { ids: [id] });
    if (!message) fail(`Message ${id} not found`);
    const buttons = (message as any).buttons as any[][] | undefined;
    if (!buttons || buttons.length === 0) fail('Message has no inline keyboard');

    // Resolve selector → button object.
    let target: any = null;
    const asIndex = Number(selector);
    if (Number.isInteger(asIndex) && asIndex > 0) {
      let i = 1;
      for (const row of buttons) for (const b of row) {
        if (i === asIndex) target = b;
        i++;
      }
    } else {
      for (const row of buttons) for (const b of row) {
        if ((b.text ?? '').trim() === selector) target = b;
      }
    }
    if (!target) fail(`Button "${selector}" not found on message ${id}`);

    // Delegate to the button's own click() method — gramjs handles the
    // callback / url / switch_inline branching internally.
    const result = await target.click({ silent: flagBool(flags, 'silent') } as any);
    print(result ?? { ok: true });
  });
};

export const action: CmdGroup = {
  send,
  edit,
  delete: del,
  forward,
  pin,
  unpin,
  react,
  'mark-read': markRead,
  click,
};
