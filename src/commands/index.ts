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

export const commandTable: CmdGroup = {
  // sessions
  login, logout, accounts, me,

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
};
