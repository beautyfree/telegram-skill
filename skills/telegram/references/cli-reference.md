# tg-skill — Full CLI reference

Every command prints JSON to stdout. Errors → stderr as `{"ok": false, "error": "..."}` and exit code != 0. Add `--account <id>` for multi-account installs.

## Sessions

| Command | Notes |
|---|---|
| `tg-skill login` | Opens a browser tab for phone → code → 2FA. Persists session to `~/.mcp-telegram/`. |
| `tg-skill logout <accountId>` | Drops the session locally + revokes server-side. |
| `tg-skill accounts` | `[{ id, phone, username }]`. |
| `tg-skill me` | Returns the authenticated user record. |

## Dialogs

```
tg-skill dialogs [--unread] [--archived] [--folder N] [--ignore-pinned] [--limit N]
tg-skill search-dialogs <query> [--limit N]
tg-skill resolve <@username|id>
```

Output shape (dialogs): `[{ id, name, title, unreadCount, date, pinned, archived }]`

## Messages — read

```
tg-skill messages <peer> [--limit N]
tg-skill search <peer> [query]
  [--filter photos|videos|photoVideo|documents|music|voice|roundVideo|roundVoice|gif|url|geo|contacts|chatPhotos|myMentions|pinned]
  [--from-user @user] [--min-date <unixSec>] [--max-date <unixSec>]
  [--limit N] [--reverse]
tg-skill search-global <query> [--filter X] [--min-date T] [--max-date T] [--limit N]
tg-skill get <peer> <id[,id...]>
```

## Messages — write

```
tg-skill send <peer> <text> [--reply-to N] [--silent] [--parse-mode markdown|html]
tg-skill edit <peer> <id> <text> [--parse-mode markdown|html]
tg-skill delete <peer> <id[,id...]> [--revoke false]
tg-skill forward --from <peer> --to <peer> --ids 1,2,3 [--silent]
tg-skill pin <peer> <id> [--notify] [--pm-one-side]
tg-skill unpin <peer> <id>
tg-skill react <peer> <id> <emoji...> [--custom-emoji-ids id,id] [--big] [--add-to-recent]
tg-skill mark-read <peer> [--max-id N]
```

`react` with no emoji clears existing reactions. Multiple emoji = multi-react (Premium).

## Media

```
tg-skill send-file <peer> <path-or-url...>
  [--caption X] [--voice] [--as-document] [--silent] [--reply-to N]
tg-skill download <peer> <messageId>
```

`send-file` accepts multiple paths/URLs — they're sent as one album (max 10). HTTPS URLs are fetched into a temp file first.

`download` writes the file to `~/.mcp-telegram/downloads/` (override via `MCP_TELEGRAM_DOWNLOADS`) and prints `{"path": "..."}`.

## Saved Messages

```
tg-skill saved tags
tg-skill saved tag-rename <emoji> [title]      # omit title to clear
tg-skill saved default-tags
tg-skill saved search [--tag emoji ...] [--tag-custom id,id] [--query X]
                    [--saved-peer P] [--limit N] [--min-date T] [--max-date T]
tg-skill saved dialogs [--exclude-pinned] [--limit N]
tg-skill saved history <peer> [--offset-id N] [--limit N]
tg-skill saved delete-history <peer> [--max-id N] [--min-date T] [--max-date T]
tg-skill saved toggle-pin <peer> [--pinned true|false]
```

Tagging a Saved message = react on it: `tg-skill react me <msg-id> 🧠`. Then `tg-skill saved search --tag 🧠` returns everything tagged that way.

## Channels

```
tg-skill info <peer>
tg-skill participants <peer> [--limit N] [--search X]
```

For full channel admin/moderation surface (ban, restrict, promote, invite-link management, slow-mode, etc.) — use the MCP server (`tg-skill mcp`) or the raw bridge below. CLI MVP covers read-only inspection.

## Raw MTProto

```
tg-skill invoke <Namespace.Class> --params '<json>'
```

Examples:

```
tg-skill invoke messages.GetStickers --params '{"emoticon": "👍", "hash": "0"}'
tg-skill invoke channels.GetFullChannel --params '{"channel": "@telegram"}'
```

Entity-like string fields (`peer`, `channel`, `user`, `bot`, `chat`, `fromPeer`, `toPeer`) are auto-hydrated from `@username` / numeric / `me`.

## Plugin install

```
tg-skill install                 # auto-detect Claude Code + Codex CLI
tg-skill install claude          # specific
tg-skill install codex
tg-skill install cursor          # generates .mdc adapter in ./.cursor/rules
tg-skill install all
tg-skill uninstall [client]
tg-skill doctor                  # JSON: which clients detected, where installed
```

## MCP server

```
tg-skill mcp                     # same as legacy `mcp-telegram` bin
```

Use when an agent client doesn't support skills (web Apps SDK, hosted runtimes without Bash).
