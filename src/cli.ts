#!/usr/bin/env node
/**
 * telegram-agent CLI entry. Three responsibilities:
 *
 *   1. Parse argv into (positional[], flags{}).
 *   2. Walk the nested command table to resolve the verb.
 *   3. Either ship the request to the daemon (fast path) or fall back to
 *      running the command in-process (cold path, ~2s connect penalty).
 *
 * Everything else lives in src/commands/* and src/daemon/*. Keep this
 * file under 200 lines.
 */
import { config as dotenvConfig } from 'dotenv';
import type { Cmd, ParsedArgs } from './commands/_shared.js';
import { classifyError, fail, print } from './commands/_shared.js';
import { commandTable } from './commands/index.js';
import { sendToDaemon } from './daemon/client.js';
import { isDaemonRunning } from './daemon/socket.js';
import { logger } from './logger.js';
import { TelegramAuthError } from './telegram.js';

dotenvConfig();

const VERSION = '1.0.0';

// ─── arg parsing ─────────────────────────────────────────────────────

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// ─── help ────────────────────────────────────────────────────────────

const HELP = `telegram-agent ${VERSION} — Telegram CLI for AI agents

USAGE
  telegram-agent <noun> <verb> [args]    e.g. telegram-agent chats list --limit 10
  telegram-agent <verb> [args]            for single-shot leaves: login, info, doctor, listen, invoke
  telegram-agent --help | --version

SESSIONS
  login                                Open the browser sign-in flow
  logout <accountId>                   Drop a session
  accounts                             List signed-in accounts
  me                                   Current account profile

ENTITY
  info <peer>                          Resolve @username / id / phone / t.me link → JSON

CHATS
  chats list      [--unread] [--archived] [--type user|bot|group|channel] [--limit N]
  chats search    "query" [--type ...] [--global] [--archived] [--limit N]
  chats members   <chat>  [--limit N] [--query t] [--type bot|admin|recent]

MESSAGES
  msg list   <chat> [--limit N] [--offset-id N] [--min-id N] [--since T]
                    [--query t] [--from <user>] [--filter photo|video|...]
                    [--auto-download] [--auto-transcribe] [--full]
  msg get    <chat> <id[,id...]>
  msg search "query" [--chat <peer>] [--from <user>] [--filter ...]
                     [--since T] [--until T] [--context N] [--limit N]
                     [--auto-download] [--auto-transcribe] [--full]

ACTIONS
  action send       <chat> [text]      [--stdin | --file PATH] [--reply-to N]
                                       [--silent] [--md|--html] [--no-preview]
  action edit       <chat> <msgId> [text]    [--stdin | --file PATH] [--md|--html]
  action delete     <chat> <id...>     [--revoke false]
  action forward    <from> <to> <id...>  (or --from/--to/--ids 1,2,3)
  action pin        <chat> <msgId>     [--notify] [--pm-one-side]
  action unpin      <chat> <msgId | --all>
  action react      <chat> <msgId> <emoji>  [--remove] [--big] [--custom-emoji-ids id,id]
  action mark-read  <chat> [--max-id N]
  action click      <chat> <msgId> <button-index-or-text>

MEDIA
  media send     <chat> <path|url...>  [--caption X] [--voice] [--as-document]
  media download <chat> <msgId>        [--out PATH]

SAVED MESSAGES (Premium reaction-tags)
  saved tags                              List tag reactions + custom titles
  saved tag-rename <emoji> [title]        Rename a tag (omit title = clear)
  saved default-tags                      Server-suggested emoji set
  saved search [--tag emoji ...] [--query X] [--saved-peer P] [--since T] [--until T] [--limit N]
  saved dialogs [--exclude-pinned] [--limit N]
  saved history <peer> [--offset-id N] [--limit N]
  saved delete-history <peer> [--max-id N] [--min-date T] [--max-date T]
  saved toggle-pin <peer> [--pinned true|false]

STREAMING
  listen <chat> [--filter X] [--since T]    One JSON object per new message.

OPS
  doctor                              Run health checks (creds, session, daemon, etc.)
  daemon start|stop|status            Manage the background gram.js client.
  invoke <Namespace.Class> --params '{...}'   Raw MTProto escape hatch.

SKILL DISTRIBUTION (not handled by this CLI)
  Use \`npx skills add beautyfree/telegram-agent -a <agent> -g\` (54+ agents)
  or your agent's native plugin command. See README.

OUTPUT
  JSON to stdout. Errors → stderr as {"ok": false, "error": "..."} + exit code 1.

ACCOUNT SELECTION
  Pass --account <id> for multi-account installs. See \`telegram-agent accounts\`.

DAEMON
  Most commands run faster (~200ms) when the daemon is up. The CLI tries
  it first and silently falls back to in-process (~2s) otherwise. Start
  with \`telegram-agent daemon start\`.
`;

// ─── dispatch ────────────────────────────────────────────────────────

interface Resolution {
  fn: Cmd;
  /** Dotted method name, e.g. "msg.list" or "login". */
  method: string;
  /** Number of argv tokens consumed by the walk. */
  consumed: number;
}

function resolve(argv: string[]): Resolution | null {
  const path: string[] = [];
  let cur: any = commandTable as any;
  for (let i = 0; i < argv.length && !argv[i].startsWith('--'); i++) {
    const tok = argv[i];
    if (typeof cur === 'object' && cur !== null && tok in cur) {
      cur = cur[tok];
      path.push(tok);
      if (typeof cur === 'function') break;
    } else {
      break;
    }
  }
  if (typeof cur !== 'function') return null;
  return { fn: cur as Cmd, method: path.join('.'), consumed: path.length };
}

/** Commands that must NOT round-trip through the daemon: they manage it. */
const DAEMON_BYPASS = new Set([
  'daemon.start',
  'daemon.stop',
  'daemon.status',
  'login',
  'logout',
  'doctor',
  'listen', // event subscriptions need their own client lifetime
]);

async function dispatch(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help' || argv[0] === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
    print({ version: VERSION });
    return;
  }

  const resolved = resolve(argv);
  if (!resolved) fail(`Unknown command: ${argv.join(' ') || '(none)'}. Run \`telegram-agent --help\`.`, 'INVALID_ARGS');

  const rest = argv.slice(resolved.consumed);
  const parsed = parseArgs(rest);

  // Fast path: try the daemon if it's running and the command is safe to
  // forward. Skip when --no-daemon is set.
  const noDaemon = parsed.flags['no-daemon'] === true;
  if (!noDaemon && !DAEMON_BYPASS.has(resolved.method)) {
    if (await isDaemonRunning()) {
      const code = await sendToDaemon({
        method: resolved.method,
        args: parsed.positional,
        flags: parsed.flags,
      });
      if (code !== null) process.exit(code);
      // null → daemon died mid-call; fall through to in-process.
    }
  }

  // In-process path.
  try {
    await resolved.fn(parsed.positional, parsed.flags);
  } catch (err) {
    if (err instanceof TelegramAuthError) {
      fail(`Session expired for ${err.accountId}. Run \`telegram-agent login\` to re-authorize.`, 'PERMISSION');
    }
    fail((err as Error).message ?? String(err), classifyError(err));
  }
}

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', err);
  fail(err.message);
});
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', reason as Error);
  fail((reason as Error)?.message ?? String(reason));
});

// Caption daemon sentinel. Re-exec'd by caption/client.ts. Stays in this
// file (not commands/) because it should never be daemonized via the
// main socket daemon and never be daemon-forwarded.
if (process.argv.includes('--caption-daemon')) {
  // Lazy import keeps caption code paths out of the cold-start critical
  // path for normal CLI calls.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  import('./caption/daemon.js').then((m) => m.runCaptionDaemon());
} else {
  dispatch(process.argv.slice(2))
    .then(() => {
      // login holds the auth-browser HTTP server alive on purpose. listen
      // never resolves. Everything else should exit clean so gram.js's
      // persistent WebSocket doesn't pin the process.
      const verb = process.argv[2];
      if (verb !== 'login' && verb !== 'listen') process.exit(0);
    })
    .catch((err) => {
      fail((err as Error).message ?? String(err));
    });
}
