# Changelog

All notable changes to `telegram-agent` are tracked here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
adheres to [Semantic Versioning](https://semver.org/).

## [1.0.11] — 2026-05-19

### Added
- **`eval <code> --confirm`** — execute JavaScript with the connected
  gram.js client. `client`, `Api`, `fs`, `path`, `success()`, `fail()`,
  `strip()` are injected into scope. Mandatory `--confirm` gate
  mirroring `invoke`.
- **`action click` rich payload** — return `{ ok, label, buttonType,
  url?, query?, userId?, copyText?, botMessage?, alert? }` for every
  inline-keyboard button class gram.js exposes (callback, url,
  web-view, switch-inline, user-profile, copy, buy, game, url-auth,
  simple-web-view). Previously returned `{ ok: true }` for most types.
- **`warn(message)`** helper in `_shared.ts` — soft stderr output that
  doesn't exit. First use: `media caption-download` prints a hint to
  stderr before the long-running model download starts.
- **Biome lint + format setup** (`biome.json`) + `npm run lint` /
  `npm run format` scripts.
- **CI lint step** — `npm run lint` runs before build + tests on every
  push/PR.
- **End-to-end test suite** (`tests/e2e/cli.test.ts`) — 8 smoke tests
  that spawn the built `dist/cli.js`: version, help, unknown command,
  destructive-method gates (eval, invoke), doctor envelope, accounts
  empty-list. No Telegram credentials needed.

### Changed
- `npm test` now runs `npm run build && vitest run` so e2e tests
  always see the latest dist.
- Switched gram.js `events` module imports from `@ts-ignore`'d
  relative paths to plain typed imports — biome was right that the
  declarations exist.
- `daemon/server.ts` + `daemon/client.ts` line-buffered readers
  rewritten to drop the assignment-in-while-condition pattern biome
  flagged.

## [1.0.10] — 2026-05-19

### Added
- **`media caption-run <file...>`** — caption arbitrary local image
  files via the caption daemon. No Telegram message required.
- **Inline keyboard buttons in `flattenMessage`** — `buttons: [{
  index, row, col, label, type, url?, data? }]` flattened from any
  `ReplyInlineMarkup`. Callback `data` is base64.
- **Per-message URL link preview** — opt-in `--preview-links` on `msg
  list / get / search` attaches `links: [{ url, title, description }]`
  to each message. Uses `messages.GetWebPagePreview`. Bounded
  concurrency, in-flight dedupe by URL.
- **`chats members --profiles`** — fan out `users.GetFullUser` per
  member to attach `profile: { about, bio, personalChannelId,
  commonChatsCount, isBlocked }`. Off by default (N extra RPCs).

## [1.0.9] — 2026-05-19

### Added
- **Error code taxonomy** — `fail()` now emits `{ ok, error, code }`
  with one of `INVALID_ARGS | NOT_FOUND | FLOOD_WAIT | PERMISSION |
  PREMIUM | UNKNOWN`. New `classifyError()` helper maps gram.js
  exceptions into the right bucket. All call sites tagged.
- **Sender name resolution** (`src/enrich/names.ts`) — batched
  `getEntity()` lookups attach `from: { id, type, name, username? }`
  and `peer: { ... }` to every message in the flat output. Per-call
  cache.
- **Auto-download small media (≤1 MB)** — `src/enrich/download.ts`'s
  `autoDownloadSmall()` always runs. `--auto-download` lifts the cap.
- **`listen` filter expansion** — `--exclude-chat`, `--exclude-type`,
  `--incoming`, and `--event new_message,edit_message,delete_messages,
  message_reactions,read_outbox,user_typing,user_status,callback_query,
  album` (default: first four).
- **`daemon log [--lines N] [--json]`** — tail the daemon stderr.
  Daemon is now spawned with stderr piped into
  `~/.telegram-agent/daemon.log`.
- **`media caption-download`** — explicit pre-fetch of Florence-2-base
  weights (~150 MB) for warming CI/Docker images.
- **`flattenMessage` + `smartDate`** — compact agent-friendly message
  shape with relative dates (`HH:MM` / `Yesterday HH:MM` / `Mon HH:MM`
  / `Mar 1 HH:MM` / `YYYY-MM-DD`). Drops empty fields.
- **`info` enrichment** — `fullInfo`, `commonGroups`, `memberCount`,
  `linkPreview` returned in parallel.

## [1.0.8] — 2026-05-18

### Added
- **`media caption <chat> <msgId>`** — local image captioning via
  Florence-2-base (q4-quantized, ~150 MB) through `@huggingface/
  transformers`. New caption daemon at `127.0.0.1:7313`, idle-exits
  after 5 minutes.

## [1.0.7] — 2026-05-18

### Changed
- **Pagination envelope is now the default shape** — every list /
  search response is `{ items, hasMore, nextOffset }`. No `--paginated`
  flag.
- **Flat-name command aliases removed** — only the noun-verb form
  resolves (`chats list`, `msg search`, `action send`, …). The
  `dialogs` / `messages` / `send` shortcuts are gone.

## [1.0.6] — 2026-05-18

### Added
- Vitest test suite (25 tests) covering FileSession, command table,
  state, daemon socket, flag helpers, `invoke` destructive matcher.
- GitHub Actions CI (Ubuntu + macOS, Node 20 + 22).
- Release workflow with npm `--provenance`.
- `--confirm` gate on destructive `invoke` calls.
- `--paginated` envelope opt-in (later promoted to default in 1.0.7).
- `media transcribe <chat> <msgId>` standalone command.
- Multi-chat `listen` (`--chat a,b,c` / `--type <kind>`).

## [1.0.5] — 2026-05-18

### Added
- `chmod 700` on `~/.telegram-agent/` + `sessions/` after every
  ensure-dirs call; `chmod 600` on each persisted session field.
- `session export <accountId>` / `session import --string|--stdin` —
  gram.js / Telethon-compatible portable session strings.
- `SECURITY.md` with the threat model + reporting flow.

## [1.0.4] — 2026-05-18

### Removed
- `MCP_TELEGRAM_HOME` / `MCP_TELEGRAM_DOWNLOADS` env back-compat.
- `~/.mcp-telegram/` directory fallback. `telegram-agent` is its own
  thing now.

## [1.0.3] — 2026-05-18

### Removed
- `mcp.json` and every cross-link to the separate `mcp-telegram` MCP
  server. Dual-transport story dropped; this is a CLI-only package.

## [1.0.2] — 2026-05-18

### Fixed
- Stop gram.js's bundled `StoreSession` from leaking session files
  into `<cwd>/Users/...` with URL-encoded filenames. New `FileSession`
  subclasses `MemorySession` directly and uses `node-localstorage`
  with a fully-resolved absolute directory.
- `doctor` now warns if a stray `<cwd>/Users/` directory exists from
  the pre-1.0.1 bug.

## [1.0.1] — 2026-05-18

### Removed
- Tool-surface picker UI from the login browser tab (artefact from
  `mcp-telegram`).
- `src/tool-catalog.ts` (287 LOC, 11 kB).

## [1.0.0] — 2026-05-18

Initial public release. Noun-verb CLI shape (`chats list`, `msg
search`, `action send`, `media download`, `saved tags`, `invoke`),
universal SKILL.md bundle, one-command install via `npx skills add
beautyfree/telegram-agent`.
