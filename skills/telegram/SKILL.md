---
name: telegram
description: Telegram CLI for AI agents. Use when the user wants to read messages, send messages, search chats, download media, tag Saved Messages with reaction-tags (Premium), moderate channels, or monitor a conversation in real time. Triggers on "check Telegram", "send a message", "search my chats", "read unread", "listen to @channel", "download from Telegram", тэг сохранёнок, чаты, каналы, @peer names, or any task that requires programmatic Telegram interaction via the `telegram-agent` CLI.
allowed-tools: Bash(telegram-agent:*)
---

# Telegram via `telegram-agent`

Operate a real Telegram user account (not a bot) from the terminal. JSON to stdout, errors to stderr. Pipe through `jq`.

## Setup check

If `telegram-agent accounts` returns `[]`, run `telegram-agent login` once. Session caches in `~/.telegram-agent/`.

Run `telegram-agent doctor` first if anything looks off — it reports credentials, session validity, daemon status.

A background daemon (`telegram-agent daemon start`) keeps the gram.js connection alive so subsequent commands run ~10× faster (~200ms vs ~2s cold). Auto-spawns on first call; idle-exits after 10 min.

## Command shape

```
telegram-agent <noun> <verb> [args] [--flags]
```

Flat aliases (`dialogs`, `messages`, `send`, etc) still work for back-compat but new code should use the noun-verb form.

## Quick map

| Goal | Command |
| --- | --- |
| List your dialogs | `chats list --limit N [--unread] [--type user\|bot\|group\|channel]` |
| Find a chat | `chats search "q" [--type ...] [--global]` |
| List members | `chats members <chat> [--type bot\|admin\|recent] [--query t]` |
| Read history | `msg list <chat> --limit N [--query t] [--from @user] [--filter photo\|video\|...]` |
| Search globally | `msg search "q" [--filter ...] [--since T] [--context N]` |
| Search in one chat | `msg search "q" --chat <peer>` |
| Fetch by id | `msg get <chat> <id[,id]>` |
| Send / edit / delete | `action send <chat> "text"` · `action edit <chat> <id> "text"` · `action delete <chat> <id...>` |
| Forward | `action forward <from> <to> <id...>` |
| Pin / unpin | `action pin <chat> <id>` · `action unpin <chat> <id\|--all>` |
| React | `action react <chat> <id> 🧠` (`--remove` to drop, `--big` for animated) |
| Mark read | `action mark-read <chat> [--max-id N]` |
| Inline button | `action click <chat> <id> <index-or-text>` |
| Files | `media send <chat> <path\|url...> [--caption X]` · `media download <chat> <id>` |
| Saved tags (Premium) | `saved tags` · `saved tag-rename 🧠 "AI"` · `saved search --tag 🧠` |
| Real-time tail | `listen <chat> [--filter ...]` (one JSON message per line) |
| Resolve a peer | `info <peer>` (accepts @username / id / phone / t.me link) |
| Raw method | `invoke <Namespace.Class> --params '{...}'` |

For deeper recipes read the matching file under `references/`:

- `cli-reference.md` — exhaustive command + flag reference
- `saved-tags.md` — categorize Saved Messages with reaction-tags
- `digest.md` — batch summary of a channel or DM
- `moderation.md` — bans, restrictions, admin-rights bitmasks
- `outreach.md` — careful cold/warm DM campaigns with caps + cooldowns

Only read those when the task matches.

## Peer syntax

Anywhere a `<chat>` / `<peer>` is accepted:

- `@username` — public username
- `me` — Saved Messages (your own user)
- numeric id (digits, may be negative for chats/channels)
- phone with `+` prefix (`info` only)
- t.me / telegram.me URL (`info` only)

## Inputs for `send` / `edit`

Three sources, in priority order: `--file <path>` → `--stdin` → positional argument.

```bash
telegram-agent action send @friend "hello"                              # positional
echo "long text" | telegram-agent action send @friend --stdin           # piped
telegram-agent action send @friend --file ./draft.md --md               # from file
```

Parse modes: `--md` (MarkdownV2) or `--html`. Default is plain text — no implicit parsing, no surprise links.

## Always-true defaults

- Output is JSON. Parse with `jq`. If parsing fails, the command printed an error to stderr — read it.
- Errors: `{"ok": false, "error": "..."}` with exit code != 0.
- Multi-account: pass `--account <id>` (see `telegram-agent accounts`).
- Destructive ops (`delete`, `delete-history`, `kick`, `ban`, raw destructive `invoke`) — confirm with the user before running unless they explicitly said "yes do it".
- Long messages truncate at 500 chars in `msg list` / `msg search`. Pass `--full` to disable.

## Common patterns

### "Find that link about X in Telegram"

```bash
telegram-agent msg search "X" --limit 50 | jq '.[] | {date, peer: .peer.title, text}'
```

### "Read the last N messages from @channel"

```bash
telegram-agent msg list @channel --limit 50 | jq '.[] | {date, text}'
```

### "Summarize @channel from today"

```bash
since=$(date -v -1d +%s 2>/dev/null || date -d '1 day ago' +%s)
telegram-agent msg list @channel --since "$since" --limit 200
```

Pipe to your summarizer. For multi-channel digests see `references/digest.md`.

### "Tag and categorize my Saved Messages by topic"

See `references/saved-tags.md` (Premium-only feature). Quick path:

```bash
telegram-agent saved tags                  # current scheme
telegram-agent msg list me --limit 100     # batch to classify
telegram-agent action react me <id> 🧠     # apply tag
telegram-agent saved tag-rename 🧠 "AI"    # name it
```

### "Monitor @channel and react to mentions of X"

```bash
telegram-agent listen @channel | while read line; do
  text=$(echo "$line" | jq -r '.text // empty')
  id=$(echo "$line" | jq -r '.id // empty')
  if [[ "$text" == *X* ]]; then
    telegram-agent action react @channel "$id" 👀
  fi
done
```

### "Click an inline button"

```bash
telegram-agent action click @bot 12345 "Confirm"   # by label
telegram-agent action click @bot 12345 1            # by 1-based index
```

## What this skill does NOT do

- Bot API operations (this is the user MTProto API; for bots, use the Bot API directly).
- Voice transcription works only with Telegram Premium on the signed-in account (`--auto-transcribe` is a no-op otherwise).
- Reaction-tags on Saved Messages require Premium.

## When to fall back to MCP

For agent runtimes without a shell (web Apps SDK, some hosted environments), install [`mcp-telegram`](https://github.com/beautyfree/mcp-telegram) as the MCP server. Both packages share the same `~/.telegram-agent/` session store — log in once.
