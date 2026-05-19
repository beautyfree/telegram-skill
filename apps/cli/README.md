# telegram-agent

Telegram CLI for AI agents. Read messages, send messages, search, download media, manage chats — all from the terminal. JSON output, designed for automation.

## Installation

### npm (all platforms)

```bash
npm i -g @avemeva/telegram-agent
```

### Bun (all platforms)

```bash
bun i -g @avemeva/telegram-agent
```

### Homebrew (macOS)

```bash
brew install avemeva/tap/telegram-agent
```

### curl (macOS/Linux)

```bash
curl -fsSL https://telegram-agent.sh/install | bash
```

### PowerShell (Windows)

```powershell
irm https://telegram-agent.sh/install.ps1 | iex
```

### CMD (Windows)

```cmd
curl -fsSL https://telegram-agent.sh/install.cmd -o install.cmd && install.cmd
```

### Verify

```bash
telegram-agent --version
telegram-agent doctor
```

## Authentication

telegram-agent connects to your **real Telegram account** — it reads and sends actual messages, not a sandbox. Authenticate before first use:

```bash
telegram-agent login                     # Log in to Telegram (interactive)
telegram-agent me                        # Verify connection
```


## How It Works

A background daemon manages the TDLib connection and auto-starts on first command. TDLib caches your chats, messages, and user data locally, so most reads are instant (~0.2s) without hitting Telegram's servers. The daemon shuts down after 10 minutes of inactivity.

## Quick Start

```bash
telegram-agent me                              # Current user info
telegram-agent chats list --limit 10           # Recent chats
telegram-agent msg list @username --limit 5    # Message history
telegram-agent action send @username "hello"   # Send a message
telegram-agent msg search "keyword"            # Search across all chats
```

## Commands

### Identity

```bash
telegram-agent me                                # Current user info
telegram-agent info <id|username|phone|link>     # Detailed entity info
```

### Chats

```bash
telegram-agent chats list [--limit N] [--unread] [--type user|group|channel]
telegram-agent chats search "query" [--type chat|bot|group|channel] [--global]
telegram-agent chats members <chat> [--limit N] [--type bot|admin|recent]
```

### Messages

```bash
telegram-agent msg list <chat> [--limit N] [--filter photo|video|document|voice]
telegram-agent msg get <chat> <msgId>
telegram-agent msg search "query" [--chat <id>] [--type private|group|channel]
```

### Actions

```bash
telegram-agent action send <chat> "text" [--html] [--md] [--reply-to N] [--silent]
telegram-agent action edit <chat> <msgId> "text" [--html]
telegram-agent action delete <chat> <msgId...> [--revoke]
telegram-agent action forward <from> <to> <msgId...>
telegram-agent action pin <chat> <msgId>
telegram-agent action react <chat> <msgId> <emoji>
telegram-agent action click <chat> <msgId> <button>
```

### Media

```bash
telegram-agent media download <chat> <msgId> [--output path]
telegram-agent media transcribe <chat> <msgId>
```

### Real-time Streaming

```bash
telegram-agent listen --type user              # Stream events as NDJSON
telegram-agent listen --chat 12345             # Stream specific chat
```

### Daemon

```bash
telegram-agent daemon start | stop | status | log
```

### Auth

```bash
telegram-agent login                           # Log in to Telegram (interactive)
telegram-agent logout                          # Log out of Telegram
```

### Advanced

```bash
telegram-agent eval '<javascript>'             # Run JS with connected TDLib client
telegram-agent doctor                          # Verify installation health
```

## Entity Arguments

All commands accepting `<chat>` support:
- Numeric ID: `12345678`, `-1001234567890`
- Username: `@username` or `username`
- Phone: `+1234567890`
- Link: `t.me/username`
- Special: `me` or `self`

## Output

All output is JSON to stdout. Errors and warnings go to stderr. Pipe through `jq` for processing:

```bash
telegram-agent chats list --unread | jq '.[].title'
telegram-agent msg search "meeting" | jq '.messages[].content'
```

## Pagination

List commands return `hasMore` and `nextOffset`. Pass the offset back to paginate:

```bash
telegram-agent msg list <chat> --limit 50
telegram-agent msg list <chat> --limit 50 --offset-id <nextOffset>
```

## Claude Code Skill

Best suited for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Install the skill to give Claude full Telegram access:

```bash
npx skills add avemeva/telegram-agent
```

## License

GPL-3.0
