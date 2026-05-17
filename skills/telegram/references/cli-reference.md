# `telegram-agent` — full CLI reference

Every command prints JSON to stdout. Errors → stderr as `{"ok": false, "error": "..."}` and exit code 1. Add `--account <id>` for multi-account installs. `--no-daemon` forces in-process execution.

## Sessions

| Command | Notes |
|---|---|
| `telegram-agent login` | Browser tab for phone → code → 2FA. Persists at `~/.telegram-agent/`. |
| `telegram-agent logout <accountId>` | Drop session locally + revoke server-side. |
| `telegram-agent accounts` | `[{ id, phone, username }]` |
| `telegram-agent me` | Authenticated user record. |
| `telegram-agent info <peer>` | Universal resolver — accepts `@username`, id, phone, t.me link. Returns `{ entity, dialog? }`. |

## Chats

```
chats list      [--unread] [--archived] [--folder N] [--ignore-pinned]
                [--type user|bot|group|channel] [--offset-date T] [--limit N]
chats search    "query" [--type ...] [--global] [--archived] [--limit N]
chats members   <chat>  [--limit N] [--query t] [--type bot|admin|recent]
```

`--global` switches `chats search` to public Telegram (returns channels you're not in yet).

## Messages — read

```
msg list <chat>
  [--limit N] [--offset-id N] [--min-id N] [--since T]
  [--query t] [--from <user>]
  [--filter photos|videos|photoVideo|documents|music|voice|roundVideo|roundVoice|gif|url|geo|contacts|chatPhotos|myMentions|pinned]
  [--auto-download] [--auto-transcribe] [--full] [--reverse]

msg get <chat> <id[,id...]>

msg search "query"
  [--chat <peer>] [--from <user>] [--filter ...]
  [--since T] [--until T] [--context N] [--limit N]
  [--auto-download] [--auto-transcribe] [--full]
```

`--auto-download` saves photos / stickers / voice notes alongside the message JSON (adds `downloadPath`). `--auto-transcribe` requests server-side transcription for voice / round-video notes (Premium; adds `transcription`). `--context N` returns `{ hit, context: [...] }` rows with N before + hit + N after.

Long bodies truncate at 500 chars with `truncated: true`. `--full` disables.

## Actions — write

```
action send       <chat> [text]              [--reply-to N] [--silent] [--md|--html]
                                              [--no-preview] [--stdin | --file PATH]
action edit       <chat> <msgId> [text]      [--md|--html] [--stdin | --file PATH]
action delete     <chat> <id...>             [--revoke false]
action forward    <from> <to> <id...>        [--silent]
action pin        <chat> <msgId>             [--notify] [--pm-one-side]
action unpin      <chat> <msgId | --all>
action react      <chat> <msgId> <emoji>     [--remove] [--big]
                                              [--custom-emoji-ids id,id]
                                              [--add-to-recent]
action mark-read  <chat>                     [--max-id N]
action click      <chat> <msgId> <button>    [--silent]
```

`action send` / `edit` body sources, in priority: `--file <path>` → `--stdin` → positional. Default is plain text — no implicit markdown parsing.

`action react` with no `<emoji>` clears all reactions on the message. `--remove <emoji>` drops only the specified tag.

`action click` references a button by 1-based index across the keyboard (left-to-right, top-to-bottom) or by exact label text.

## Media

```
media send     <chat> <path-or-url...>       [--caption X] [--voice]
                                              [--as-document] [--silent] [--reply-to N]
media download <chat> <msgId>                [--out PATH]
```

`media send` accepts multiple paths/URLs — sent as one album (max 10). HTTPS URLs are fetched into a temp file first.

`media download` saves to `~/.telegram-agent/downloads/` by default; override per-call with `--out PATH` or globally with `TELEGRAM_AGENT_DOWNLOADS`.

## Saved Messages (Premium reaction-tags)

```
saved tags                                    List tag reactions + custom titles
saved tag-rename <emoji> [title]              Set/clear the custom title
saved default-tags                            Server-suggested emoji set
saved search [--tag emoji ...] [--tag-custom id,id]
             [--query X] [--saved-peer P] [--since T] [--until T] [--limit N]
saved dialogs [--exclude-pinned] [--limit N]
saved history <peer> [--offset-id N] [--limit N]
saved delete-history <peer> [--max-id N] [--min-date T] [--max-date T]
saved toggle-pin <peer> [--pinned true|false]
```

Tagging a Saved message = `action react me <msg-id> <emoji>`. Then `saved search --tag <emoji>` retrieves everything tagged that way.

## Streaming

```
listen <chat> [--filter ...] [--since T]
```

Subscribes to `NewMessage` for the chat. Writes one JSON line per event (`{event: "message", id, date, text, ...}`). Runs until Ctrl-C — the daemon doesn't proxy this command, it stays in-process so the WebSocket lifetime is bounded by the CLI.

## Operations

```
doctor                  Health check: creds, session, state dir, daemon, account count.
daemon start            Spawn the background gram.js client (auto-spawns on first
                        real command if missing).
daemon stop             SIGTERM the daemon.
daemon status           { running, pid, socket, idleTimeoutMs }
```

## Raw MTProto

```
invoke <Namespace.Class> --params '<json>'
```

Examples:

```bash
telegram-agent invoke messages.GetStickers --params '{"emoticon": "👍", "hash": "0"}'
telegram-agent invoke channels.GetFullChannel --params '{"channel": "@telegram"}'
```

Entity-like string fields (`peer`, `channel`, `user`, `bot`, `chat`, `fromPeer`, `toPeer`) auto-hydrated from `@username` / numeric / `me`.

## Skill distribution (not handled by this CLI)

```
npx skills add beautyfree/telegram-agent -a <agent> -g
# e.g.
npx skills add beautyfree/telegram-agent -a claude-code -g
```

See the project README for per-agent native commands.

## MCP server

`telegram-agent` doesn't ship a `mcp` subcommand. For the always-on tool-call transport, install [`mcp-telegram`](https://github.com/beautyfree/mcp-telegram) separately — it shares the same `~/.telegram-agent/` session store, so one login covers both.

## Back-compat aliases

Old flat command names still resolve to their new noun-verb leaves:

| Old | New |
|---|---|
| `dialogs` | `chats list` |
| `search-dialogs` | `chats search` |
| `participants` | `chats members` |
| `resolve` | `info` (richer output — entity + dialog) |
| `messages` | `msg list` |
| `search` / `search-global` | `msg search` (`--chat <peer>` to narrow) |
| `get` | `msg get` |
| `send`, `edit`, `delete`, `forward`, `pin`, `unpin`, `react`, `mark-read` | `action <verb>` |
| `send-file`, `download` | `media <verb>` |
