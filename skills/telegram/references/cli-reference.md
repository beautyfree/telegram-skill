# telegram-agent — Full CLI reference

Every command prints JSON to stdout. Errors → stderr as `{"ok": false, "error": "..."}` and exit code != 0. Add `--account <id>` for multi-account installs.

## Sessions

| Command | Notes |
|---|---|
| `telegram-agent login` | Opens a browser tab for phone → code → 2FA. Persists session to `~/.telegram-agent/`. |
| `telegram-agent logout <accountId>` | Drops the session locally + revokes server-side. |
| `telegram-agent accounts` | `[{ id, phone, username }]`. |
| `telegram-agent me` | Returns the authenticated user record. |

## Dialogs

```
telegram-agent dialogs [--unread] [--archived] [--folder N] [--ignore-pinned] [--limit N]
telegram-agent search-dialogs <query> [--limit N]
telegram-agent resolve <@username|id>
```

Output shape (dialogs): `[{ id, name, title, unreadCount, date, pinned, archived }]`

## Messages — read

```
telegram-agent messages <peer> [--limit N]
telegram-agent search <peer> [query]
  [--filter photos|videos|photoVideo|documents|music|voice|roundVideo|roundVoice|gif|url|geo|contacts|chatPhotos|myMentions|pinned]
  [--from-user @user] [--min-date <unixSec>] [--max-date <unixSec>]
  [--limit N] [--reverse]
telegram-agent search-global <query> [--filter X] [--min-date T] [--max-date T] [--limit N]
telegram-agent get <peer> <id[,id...]>
```

## Messages — write

```
telegram-agent send <peer> <text> [--reply-to N] [--silent] [--parse-mode markdown|html]
telegram-agent edit <peer> <id> <text> [--parse-mode markdown|html]
telegram-agent delete <peer> <id[,id...]> [--revoke false]
telegram-agent forward --from <peer> --to <peer> --ids 1,2,3 [--silent]
telegram-agent pin <peer> <id> [--notify] [--pm-one-side]
telegram-agent unpin <peer> <id>
telegram-agent react <peer> <id> <emoji...> [--custom-emoji-ids id,id] [--big] [--add-to-recent]
telegram-agent mark-read <peer> [--max-id N]
```

`react` with no emoji clears existing reactions. Multiple emoji = multi-react (Premium).

## Media

```
telegram-agent send-file <peer> <path-or-url...>
  [--caption X] [--voice] [--as-document] [--silent] [--reply-to N]
telegram-agent download <peer> <messageId>
```

`send-file` accepts multiple paths/URLs — they're sent as one album (max 10). HTTPS URLs are fetched into a temp file first.

`download` writes the file to `~/.telegram-agent/downloads/` (override via `TELEGRAM_AGENT_DOWNLOADS`) and prints `{"path": "..."}`.

## Saved Messages

```
telegram-agent saved tags
telegram-agent saved tag-rename <emoji> [title]      # omit title to clear
telegram-agent saved default-tags
telegram-agent saved search [--tag emoji ...] [--tag-custom id,id] [--query X]
                    [--saved-peer P] [--limit N] [--min-date T] [--max-date T]
telegram-agent saved dialogs [--exclude-pinned] [--limit N]
telegram-agent saved history <peer> [--offset-id N] [--limit N]
telegram-agent saved delete-history <peer> [--max-id N] [--min-date T] [--max-date T]
telegram-agent saved toggle-pin <peer> [--pinned true|false]
```

Tagging a Saved message = react on it: `telegram-agent react me <msg-id> 🧠`. Then `telegram-agent saved search --tag 🧠` returns everything tagged that way.

## Channels

```
telegram-agent info <peer>
telegram-agent participants <peer> [--limit N] [--search X]
```

For full channel admin/moderation surface (ban, restrict, promote, invite-link management, slow-mode, etc.) — use the MCP server (`mcp-telegram`) or the raw bridge below. CLI MVP covers read-only inspection.

## Raw MTProto

```
telegram-agent invoke <Namespace.Class> --params '<json>'
```

Examples:

```
telegram-agent invoke messages.GetStickers --params '{"emoticon": "👍", "hash": "0"}'
telegram-agent invoke channels.GetFullChannel --params '{"channel": "@telegram"}'
```

Entity-like string fields (`peer`, `channel`, `user`, `bot`, `chat`, `fromPeer`, `toPeer`) are auto-hydrated from `@username` / numeric / `me`.

## Skill distribution (not handled by this CLI)

`telegram-agent` only talks to Telegram. To install or update this skill in your
agent, use the universal installer or your agent's native command:

```
npx skills add beautyfree/telegram-agent -a <agent> -g
# e.g.
npx skills add beautyfree/telegram-agent -a claude-code -g
```

See the project README for the per-agent native commands.

## MCP server

`telegram-agent` doesn't ship a `mcp` subcommand. For the always-on tool-call
transport, install [`mcp-telegram`](https://github.com/beautyfree/mcp-telegram)
separately — it shares the same `~/.telegram-agent/` session store so one
login covers both.
