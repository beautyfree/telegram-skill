/**
 * Single source of truth for the CLI command table. Both the CLI
 * dispatcher (src/cli.ts) and the daemon server (src/daemon/server.ts)
 * read from this, so in-process and over-the-socket execution paths
 * stay byte-for-byte identical.
 *
 * Shape: noun-verb only.
 *
 *   telegram-agent <noun> <verb> [args]
 *
 * Single-shot leaves (login, info, doctor, listen, daemon, invoke) sit
 * at the top level next to the noun groups.
 */
import type { CmdGroup } from './_shared.js';
import { action } from './action.js';
import { chats } from './chats.js';
import { daemon } from './daemon.js';
import { doctor } from './doctor.js';
import { evalCmd } from './eval.js';
import { info } from './info.js';
import { invoke } from './invoke.js';
import { listen } from './listen.js';
import { media } from './media.js';
import { msg } from './msg.js';
import { saved } from './saved.js';
import { session } from './session.js';
import { accounts, login, logout, me } from './sessions.js';

export const commandTable: CmdGroup = {
  // sessions
  login,
  logout,
  accounts,
  me,

  // noun groups
  chats,
  msg,
  action,
  media,
  saved,
  session,

  // single-shot leaves
  info,
  doctor,
  listen,
  daemon,
  invoke,
  eval: evalCmd,
};
