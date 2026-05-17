<p align="center">
  <img width="20%" src="assets/logo.png" alt="telegram-skill" />
</p>
<p align="center">
  <h1 align="center">telegram-skill</h1>
</p>
<p align="center">
  <b>The universal Telegram agent-skill</b> for Claude Code, Codex CLI, Cursor, Gemini CLI, Cline, and Windsurf. Lazy-loaded — <b>~50× lower context cost</b> than an always-on MCP server. Standalone <code>tg-skill</code> CLI, the <a href="https://code.claude.com/docs/en/skills">SKILL.md</a> bundle, and one-command install for every major AI coding agent.
</p>
<div align="center">

[![npm version](https://badgen.net/npm/v/telegram-skill)](https://www.npmjs.com/package/telegram-skill)
[![License](https://img.shields.io/npm/l/telegram-skill)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

</div>

Plugs your AI coding agent into a real Telegram user account via [MTProto](https://core.telegram.org/mtproto). The agent reads `SKILL.md` only when your prompt mentions Telegram — the rest of the time your context budget is untouched. Standalone: no MCP server in the loop, talks to Telegram directly through gram.js.

**Use it to:** read dialogs · global message search · send / edit / forward / react · tag Saved Messages with reaction-tags (Premium) · moderate channels · send & download files · call raw MTProto methods. All against your real user account — no bot needed.

> [!WARNING]
> This signs in as a real Telegram user (not a bot). Sessions live in `~/.telegram-agent/`. Treat that directory like a password.

## Why this exists

The standard way to give an agent Telegram access is an [MCP server](https://github.com/beautyfree/mcp-telegram) that loads ~12,700 tokens of tool schemas into the model's system prompt on every turn — whether you mention Telegram or not. `telegram-skill` takes the opposite approach: the agent client scans short skill *descriptions* (~50 tokens) and only loads the full instructions if your request matches.

| Transport | When to use | Context cost (idle) | Per-task cost |
| --- | --- | --- | --- |
| **MCP server** ([`mcp-telegram`](https://github.com/beautyfree/mcp-telegram)) | Any MCP client; hosted runtimes; web Apps SDK | ~12,700 tokens | covered by tool schemas |
| **Skill bundle** (this package) | Claude Code · Codex CLI · Cursor · Gemini CLI · Cline · Windsurf | **0 tokens** until matched | ~250 tokens active |

The two packages share the on-disk session store (`~/.telegram-agent/`) — sign in once, use either or both.

## Prerequisites

- Node.js `>=20`
- Telegram API credentials from [my.telegram.org/apps](https://my.telegram.org/apps) — `api_id` and `api_hash`

## Install

```bash
npm install -g telegram-skill
```

Now sign in (one-time, opens a local browser):

```bash
export TELEGRAM_API_ID=123456
export TELEGRAM_API_HASH=abc...
tg-skill login
```

Then drop the skill into each agent you use:

```bash
tg-skill install            # auto-detect every supported agent on this machine
tg-skill doctor             # JSON report: which clients detected, where installed
```

That's it. Open Claude Code / Codex / Cursor / Gemini / Cline / Windsurf and ask:

> *"summarize @hackernews from today"*
> *"tag my Saved Messages by topic"*
> *"send 'hello' to @friend"*
> *"find that link about Cloudflare Workers in my chats"*

The agent reads `SKILL.md`, shells out to `tg-skill <command>`, parses JSON, responds.

## Install for specific agents

`tg-skill install` writes the bundle in the exact layout each client expects. Run it without arguments to install everywhere, or pass a single target:

```bash
tg-skill install claude     # ~/.claude/skills/telegram/
tg-skill install codex      # ~/.agents/skills/telegram/
tg-skill install cursor     # ~/.cursor/plugins/local/telegram/ (native plugin)
tg-skill install gemini     # ~/.gemini/skills/telegram/
tg-skill install cline      # ~/.clinerules/telegram/
tg-skill install windsurf   # ./.windsurf/rules/telegram.md (project)
tg-skill install all
tg-skill uninstall [client]
```

Per-agent reference — what `tg-skill install <agent>` does, and the native command for users who prefer their client's standard plugin UX:

<details>
<summary><b>Claude Code</b></summary>

`tg-skill install claude` copies the universal SKILL.md bundle to `~/.claude/skills/telegram/`. Claude Code picks it up on the next session start — no reload needed.

Native marketplace install (alternative):

```
/plugin marketplace add beautyfree/telegram-skill
/plugin install telegram@telegram-skill
```

Then `/reload-plugins` to activate without restarting.
</details>

<details>
<summary><b>Codex CLI</b></summary>

`tg-skill install codex` copies the bundle to `~/.agents/skills/telegram/` per the [Agent Skills spec](https://developers.openai.com/codex/skills). Codex picks it up on the next CLI invocation.

Inside Codex you can also trigger it explicitly with `$telegram` or `/skills`.
</details>

<details>
<summary><b>Cursor</b></summary>

`tg-skill install cursor` writes a full Cursor plugin (`~/.cursor/plugins/local/telegram/`) with `.cursor-plugin/plugin.json`, `skills/`, and an `mcp.json` so the same install enables both the skill and (optionally) the MCP server inside Cursor. Cursor reloads plugins automatically.

Native marketplace install (alternative): `/add-plugin` and point at this repo.
</details>

<details>
<summary><b>Gemini CLI</b></summary>

`tg-skill install gemini` copies the bundle to `~/.gemini/skills/telegram/`. Recognized by Gemini CLI's skill loader.

Native install (alternative):

```bash
gemini extensions install https://github.com/beautyfree/telegram-skill
```
</details>

<details>
<summary><b>Cline</b></summary>

`tg-skill install cline` writes `~/.clinerules/telegram/telegram.md` plus the `references/` folder. Cline's rules engine reads it on every prompt and only follows the body when the description matches.
</details>

<details>
<summary><b>Windsurf</b></summary>

`tg-skill install windsurf` writes `./.windsurf/rules/telegram.md` in the current project with `trigger: model_decision` — Windsurf activates it only when the model determines it's relevant.

This one is project-scoped; run it inside each project where you want Telegram available.
</details>

<details>
<summary><b>Goose</b></summary>

Goose uses YAML recipes rather than a skill-file model, so it isn't a direct `tg-skill install` target. Wire `tg-skill` (the binary) into a recipe's `extensions:` section if you want it inside a Goose flow. For the MCP path, use [`mcp-telegram`](https://github.com/beautyfree/mcp-telegram) directly inside a recipe instead.
</details>

## What it does

A single `tg-skill` CLI command exposes the whole Telegram surface:

| Group | Commands |
| --- | --- |
| **Sessions** | `login`, `logout`, `accounts`, `me` |
| **Dialogs** | `dialogs`, `search-dialogs`, `resolve` |
| **Messages (read)** | `messages`, `search`, `search-global`, `get` |
| **Messages (write)** | `send`, `edit`, `delete`, `forward`, `pin`, `unpin`, `react`, `mark-read` |
| **Media** | `send-file`, `download` |
| **Saved Messages** | `saved tags`, `saved tag-rename`, `saved search`, `saved dialogs`, `saved history`, `saved delete-history`, `saved toggle-pin` |
| **Channels** | `info`, `participants` |
| **Raw MTProto** | `invoke <Namespace.Class> --params '{...}'` |
| **Plugin** | `install`, `uninstall`, `doctor` |

Every command prints JSON to stdout. Pipe through `jq`:

```bash
tg-skill dialogs --limit 10 | jq '.[] | {title, unreadCount}'
tg-skill search-global "stripe pricing" --limit 20
tg-skill saved tags
tg-skill react me 12345 🧠                # tag a Saved Message
tg-skill saved search --tag 🧠 --limit 50 # pull everything tagged "🧠"
```

Run `tg-skill help` for the full flag reference.

## How it works

1. **Session** — `tg-skill login` opens a tiny local browser page that walks you through phone → SMS → 2FA. The session persists at `~/.telegram-agent/`. The directory is shared with [`mcp-telegram`](https://github.com/beautyfree/mcp-telegram) so users running both transports sign in once.

2. **Skill bundle** — one `SKILL.md` (frontmatter `name` + `description`, ~250 tokens) plus 5 lazy-loaded references under `references/`:
   - `cli-reference.md` — every command + flag with examples
   - `saved-tags.md` — categorize Saved Messages with reaction-tags
   - `digest.md` — batch summary of a channel or DM
   - `moderation.md` — bans, restrictions, admin-rights bitmasks
   - `outreach.md` — careful cold/warm DM campaigns with caps + cooldowns

   The agent reads `SKILL.md` only when your request matches the description. References load on-demand inside that activation.

3. **CLI** — `tg-skill` is a thin JSON-first wrapper around [gram.js](https://github.com/gram-js/gramjs). No MCP server in the loop.

4. **Installer** — `tg-skill install` detects each client by `$HOME` path and writes the skill in the layout that client expects. Cursor gets a full plugin (with `.cursor-plugin/plugin.json` + `skills/` + `mcp.json`) so the same install enables both transports.

## Compatibility matrix

| Agent | Format | Install target | Status |
| --- | --- | --- | --- |
| Claude Code | Universal SKILL.md | `~/.claude/skills/telegram/` | ✅ verified |
| Codex CLI | Universal SKILL.md | `~/.agents/skills/telegram/` | ✅ verified |
| Cursor | Native plugin | `~/.cursor/plugins/local/telegram/` | ✅ verified |
| Gemini CLI | Skill / extension | `~/.gemini/skills/telegram/` | extension manifest shipped |
| Cline | Rule pack | `~/.clinerules/telegram/` | `.md` adapter |
| Windsurf | Project rule | `.windsurf/rules/telegram.md` | `model_decision` trigger |
| Goose | YAML recipe | wire `tg-skill` into a recipe | bring-your-own integration |

## Environment

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `TELEGRAM_API_ID` | yes | — | From my.telegram.org/apps. Prompted on first login if unset. |
| `TELEGRAM_API_HASH` | yes | — | Same as above. |
| `TELEGRAM_AGENT_HOME` | no | `~/.telegram-agent` | State + session storage. Legacy `MCP_TELEGRAM_HOME` accepted. If only `~/.mcp-telegram/` exists from a previous install, it's used automatically. |
| `TELEGRAM_AGENT_DOWNLOADS` | no | `$TELEGRAM_AGENT_HOME/downloads` | Where `download` saves files. Legacy `MCP_TELEGRAM_DOWNLOADS` accepted. |
| `LOG_LEVEL` | no | `info` | Set to `debug` for verbose stderr. |

## FAQ

**Do I need Telegram Premium?**
No. Saved Messages reaction-tags are Premium-only; everything else works on a free account.

**Bot or user account?**
User account. This is the MTProto API, not the Bot API. The agent acts as you. Treat your session like a password.

**Is my data going somewhere?**
The session lives in `~/.telegram-agent/` on your machine. No third-party server.

**What about real-time push notifications?**
The skill/CLI path is request-response. For long-poll / streaming, run [`mcp-telegram`](https://github.com/beautyfree/mcp-telegram) as the MCP server alongside.

**Does it work with a Telegram Bot API token?**
No — this uses MTProto. For Bot API, you want a different package.

**Does `mcp-telegram` still work?**
Yes, unchanged. The two packages are independent. Use whichever transport fits your client, or both (the session store is shared).

## Related

- [`mcp-telegram`](https://github.com/beautyfree/mcp-telegram) — the underlying MCP server, for clients that only speak MCP.
- [Anthropic Skills](https://code.claude.com/docs/en/skills) — the universal SKILL.md format spec.
- [Codex Agent Skills](https://developers.openai.com/codex/skills) — OpenAI's adoption of the same format.
- [Cursor Plugins](https://cursor.com/docs/plugins) — Cursor's native plugin system.
- [Gemini CLI Extensions](https://geminicli.com/docs/extensions/) — Google's extension manifest.
- [gram.js](https://github.com/gram-js/gramjs) — the MTProto client under the hood.
