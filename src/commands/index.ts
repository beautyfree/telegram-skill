/**
 * Single source of truth for the CLI command table. Both the CLI
 * dispatcher (src/cli.ts) and the daemon server (src/daemon/server.ts)
 * read from this so the in-process and over-the-socket execution paths
 * stay byte-for-byte identical.
 *
 * Layout follows the avemeva/agent-telegram noun-verb shape:
 *
 *   telegram-agent <noun> <verb> [args]   (preferred)
 *   telegram-agent <flat-alias>     [args] (kept for back-compat)
 */
import type { CmdGroup } from './_shared.js';
import { login, logout, accounts, me } from './sessions.js';
import { info } from './info.js';
import { chats } from './chats.js';
import { msg } from './msg.js';
import { action } from './action.js';
import { media } from './media.js';
import { saved } from './saved.js';
import { session } from './session.js';
import { doctor } from './doctor.js';
import { listen } from './listen.js';
import { daemon } from './daemon.js';
import { invoke } from './invoke.js';

// Pull individual leaves out of the noun groups so we can re-expose them
// as flat aliases under the old, pre-refactor names.
const chatsList = (chats.list) as any;
const chatsSearch = (chats.search) as any;
const chatsMembers = (chats.members) as any;
const msgList = (msg.list) as any;
const msgGet = (msg.get) as any;
const msgSearch = (msg.search) as any;
const actionSend = (action.send) as any;
const actionEdit = (action.edit) as any;
const actionDelete = (action.delete) as any;
const actionForward = (action.forward) as any;
const actionPin = (action.pin) as any;
const actionUnpin = (action.unpin) as any;
const actionReact = (action.react) as any;
const actionMarkRead = (action['mark-read']) as any;
const mediaSend = (media.send) as any;
const mediaDownload = (media.download) as any;

/**
 * Top-level command table consumed by both dispatcher paths.
 */
export const commandTable: CmdGroup = {
  // ── sessions
  login, logout, accounts, me,

  // ── nouns (preferred shape)
  chats,
  msg,
  action,
  media,
  saved,
  session,

  // ── single-shot leaves
  info,
  doctor,
  listen,
  daemon,
  invoke,

  // ── back-compat aliases. Each maps an old flat name onto the new
  // noun-verb leaf so nothing existing breaks.
  dialogs: chatsList,
  'search-dialogs': chatsSearch,
  participants: chatsMembers,
  resolve: info, // returns more than the old resolve, callers that
                 // expect a flat entity should switch to .entity.
  messages: msgList,
  search: msgSearch,                 // narrowed: --chat omitted = global
  'search-global': msgSearch,        // alias of `search` without --chat
  get: msgGet,
  send: actionSend,
  edit: actionEdit,
  delete: actionDelete,
  forward: actionForward,
  pin: actionPin,
  unpin: actionUnpin,
  react: actionReact,
  'mark-read': actionMarkRead,
  'send-file': mediaSend,
  download: mediaDownload,
};
