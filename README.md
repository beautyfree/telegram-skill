<p align="center">
  <h1 align="center">telegram-skill</h1>
</p>
<p align="center">
  <b>Telegram agent-skill</b> for Claude Code, Codex CLI, Cursor, Gemini CLI, Cline, and Windsurf. Lazy-loaded — <b>~50× lower context cost</b> than an always-on MCP server. Ships the <code>tg-skill</code> CLI, the universal <a href="https://code.claude.com/docs/en/skills">SKILL.md</a> bundle, and one-command install for every major AI coding agent.
</p>
<div align="center">

[![npm version](https://badgen.net/npm/v/telegram-skill)](https://www.npmjs.com/package/telegram-skill)
[![License](https://img.shields.io/npm/l/telegram-skill)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

</div>

A universal **Telegram agent-skill** that plugs your AI coding agent into a real Telegram user account via [MTProto](https://core.telegram.org/mtproto). Built on [`mcp-telegram`](https://github.com/beautyfree/mcp-telegram) for the underlying client, but ships a *lazy-loaded* transport: the agent only reads the skill instructions when your prompt mentions Telegram, instead of permanently injecting 100+ tool schemas into context.

> **TL;DR** — `npm i -g telegram-skill && tg-skill login && tg-skill install`. Then ask any of Claude Code / Codex CLI / Cursor / Gemini CLI / Cline / Windsurf to use Telegram.

## Why this exists

The standard way to give an AI agent Telegram access is an MCP server (`mcp-telegram`). MCP servers eagerly load every tool schema into the model's system prompt — ~12,700 tokens for the full Telegram surface, every turn, whether the user is asking about Telegram or not.

The [universal `SKILL.md` format](https://code.claude.com/docs/en/skills) takes a different approach: the agent client scans short skill *descriptions* (~50 tokens each) and only loads the full instructions if the user's request matches. For 90% of sessions where Telegram never comes up, your context budget is untouched.

| Transport | When to use | Context cost (idle) | Per-task cost |
|---|---|---|---|
| **MCP server** ([`mcp-telegram`](https://github.com/beautyfree/mcp-telegram)) | Any MCP client, hosted runtimes, web apps without a shell | ~12,700 tokens always | covered by tool schemas |
| **Skill bundle** (this package) | Claude Code, Codex CLI, Cursor, Gemini CLI, Cline, Windsurf | **0 tokens** (description-matched) | ~250 tokens on activation |

The two are complementary. Skill bundle includes a `mcp.json` so clients that support both modes can opt into the MCP server inside a single plugin install.

## What it does

Through one `tg-skill` CLI command the agent can:

- **Read dialogs** — list chats and channels, filter by unread, paginate
- **Global search** — find that link or quote across every chat (`tg-skill search-global "stripe pricing"`)
- **Read messages** — list, search with type/sender/date filters, fetch by id
- **Send & edit** — DMs, channels, replies, parse-mode (markdown/HTML), albums, files, voice notes
- **React** — reactions, default reactions, custom emoji
- **Saved Messages tags (Premium)** — categorize saved items by reaction-emoji as tags, rename tags, filter Saved by tag, forum-style sub-dialogs
- **Channel ops** — `info`, `participants`; full moderation surface via raw MTProto or the MCP fallback
- **Files** — send local paths or HTTPS URLs (auto-fetched), download media to disk
- **Raw MTProto** — `tg-skill invoke <Namespace.Class> --params '{...}'` for any method not surfaced

JSON-first output. Pipe through `jq`. Multi-account.

## Install

### 0. One-time setup

```bash
npm i -g telegram-skill           # installs tg-skill + telegram-skill bins
tg-skill login                    # opens a browser → phone → code → 2FA
```

Session persists at `~/.mcp-telegram/` (shared with `mcp-telegram` if you also use the MCP server). You need API credentials from [my.telegram.org/apps](https://my.telegram.org/apps); export them once:

```bash
export TELEGRAM_API_ID=123456
export TELEGRAM_API_HASH=abc...
```

### 1. Install the skill into your agent

**Auto-detect everything you have:**

```bash
tg-skill install                  # detects and installs into every client present
tg-skill doctor                   # JSON: which clients detected, where installed
```

**Target specific clients:**

```bash
tg-skill install claude           # ~/.claude/skills/telegram/
tg-skill install codex            # ~/.agents/skills/telegram/
tg-skill install cursor           # ~/.cursor/plugins/local/telegram/ (native plugin)
tg-skill install gemini           # ~/.gemini/skills/telegram/
tg-skill install cline            # ~/.clinerules/telegram/
tg-skill install windsurf         # ./.windsurf/rules/telegram.md (project)
tg-skill install all
```

### 2. Use from any agent

Open Claude Code / Codex CLI / Cursor / Gemini / Cline / Windsurf. Ask:

> *"summarize @hackernews from today"*
> *"tag my Saved Messages by topic"*
> *"send 'hello' to @friend"*
> *"find that link about Cloudflare Workers in my chats"*

The agent reads `SKILL.md`, shells out to `tg-skill <command>`, parses JSON, responds. No MCP server running.

### Per-client native install (alternative)

Every supported client has a native install command. The skill bundle's marketplace manifests (`.claude-plugin/marketplace.json`, `.cursor-plugin/plugin.json`, `gemini-extension.json`) make those one-liners possible:

| Client | Native command |
|---|---|
| Claude Code | `/plugin marketplace add beautyfree/telegram-skill` → `/plugin install telegram@telegram-skill` |
| Cursor | `/add-plugin` (point at this repo) or clone into `~/.cursor/plugins/local/telegram/` |
| Gemini CLI | `gemini extensions install https://github.com/beautyfree/telegram-skill` |
| Codex CLI | `$skill-installer` (catalog) or copy `skills/telegram/` into `~/.agents/skills/` |
| Cline | Drop `~/.clinerules/telegram/` |
| Windsurf | Drop `.windsurf/rules/telegram.md` |

`tg-skill install` is the easy path; the native commands are for users who want their client's standard plugin UX.

## CLI reference (short)

```
tg-skill login | logout <id> | accounts | me

tg-skill dialogs [--unread] [--archived] [--limit N]
tg-skill search-dialogs <query>
tg-skill resolve <@username|id>

tg-skill messages <peer> [--limit N]
tg-skill search <peer> [query] [--filter X] [--from-user U] [--limit N]
tg-skill search-global <query> [--filter X] [--limit N]
tg-skill get <peer> <id[,id]>

tg-skill send <peer> <text> [--reply-to N] [--silent] [--parse-mode markdown|html]
tg-skill edit <peer> <id> <text>
tg-skill delete <peer> <id[,id]>
tg-skill forward --from <peer> --to <peer> --ids 1,2,3
tg-skill pin / unpin <peer> <id>
tg-skill react <peer> <id> <emoji...>
tg-skill mark-read <peer>

tg-skill send-file <peer> <path-or-url...> [--caption X]
tg-skill download <peer> <id>

tg-skill saved tags
tg-skill saved tag-rename <emoji> [title]
tg-skill saved search [--tag emoji ...] [--query X]
tg-skill saved dialogs / history <peer> / delete-history <peer> / toggle-pin <peer>

tg-skill info <peer>
tg-skill participants <peer> [--limit N] [--search X]

tg-skill invoke <Namespace.Class> --params '{...}'

tg-skill install [client] | uninstall [client] | doctor
tg-skill mcp                     # delegates to mcp-telegram (full MCP surface)
```

Run `tg-skill help` for the full reference.

## How it works

1. **Session** — `tg-skill login` opens a tiny local browser page that walks you through phone → SMS → 2FA. The session is stored at `~/.mcp-telegram/`. Re-used by both `mcp-telegram` and `tg-skill`.

2. **Skill bundle** — a single `SKILL.md` with YAML frontmatter (`name`, `description`) plus 5 lazy-loaded reference docs under `references/`:
   - `cli-reference.md` — every command + flag
   - `saved-tags.md` — categorize Saved Messages with reaction-tags
   - `digest.md` — batch summary of a channel or DM
   - `moderation.md` — ban/restrict/promote via raw MTProto
   - `outreach.md` — careful cold/warm DM campaigns with caps + cooldowns

3. **CLI** — `tg-skill` is a thin JSON-first wrapper. Built on [`mcp-telegram`](https://github.com/beautyfree/mcp-telegram), imports its Telegram client + helpers.

4. **Installer** — `tg-skill install` detects each client by `$HOME` path (e.g. `~/.claude`, `~/.agents`, `~/.cursor`) and writes the skill bundle in the layout that client expects. Cursor gets a full plugin with `.cursor-plugin/plugin.json` + `skills/` + `mcp.json` so the same install enables both transports.

## Compatibility matrix

| Agent | Skill format | Install path | Tested |
|---|---|---|---|
| **Claude Code** | Universal SKILL.md | `~/.claude/skills/telegram/` | ✅ |
| **Codex CLI** | Universal SKILL.md | `~/.agents/skills/telegram/` | ✅ |
| **Cursor** | Native plugin | `~/.cursor/plugins/local/telegram/` | ✅ |
| **Gemini CLI** | Skill | `~/.gemini/skills/telegram/` | via extension manifest |
| **Cline** | Rule pack | `~/.clinerules/telegram/` | via `.md` adapter |
| **Windsurf** | Rule | `.windsurf/rules/telegram.md` | via `model_decision` trigger |
| **Goose** | YAML recipe | use `mcp.json` in a recipe | MCP path |

## Frequently asked

**Do I need Premium?** No. Saved Messages reaction-tags are Premium-only; everything else works on a free account.

**Bot or user account?** User account. This is the MTProto API, not the Bot API. The agent acts as you.

**Is my data going somewhere?** The session lives in `~/.mcp-telegram/` on your machine. No third-party server. Treat that directory like a password.

**What about real-time push notifications?** The skill/CLI path is request-response. For long-poll / streaming, switch to the MCP server (`tg-skill mcp` or the `mcp-telegram` package).

**Does it work with the Bot API token?** No — this is MTProto, not the Bot API.

**Does mcp-telegram still work?** Yes, unchanged. `telegram-skill` builds on it. Use whichever transport fits your client.

## Related

- **[mcp-telegram](https://github.com/beautyfree/mcp-telegram)** — the underlying MCP server. Use this if your client only speaks MCP (web Apps SDK, hosted runtimes), or you want the always-on tool surface in clients without skills support.
- **[Anthropic Skills docs](https://code.claude.com/docs/en/skills)** — the universal SKILL.md format spec.
- **[Codex Agent Skills](https://developers.openai.com/codex/skills)** — OpenAI's adoption of the same format.
- **[Cursor Plugins](https://cursor.com/docs/plugins)** — native plugin system that reads SKILL.md.
- **[Gemini CLI Extensions](https://geminicli.com/docs/extensions/)** — Google's extension manifest.

## License

MIT — see [LICENSE](LICENSE).
