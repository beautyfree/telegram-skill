<p align="center">
  <img width="20%" src="assets/logo.png" alt="telegram-agent" />
</p>
<p align="center">
  <h1 align="center">telegram-agent</h1>
</p>
<p align="center">
  <b>The universal Telegram agent-skill</b> for Claude Code, Codex CLI, Cursor, Gemini CLI, Cline, Windsurf, OpenCode, and 40+ other AI coding agents. Lazy-loaded — <b>~50× lower context cost</b> than an always-on MCP server. Standalone <code>telegram-agent</code> CLI, the universal <a href="https://code.claude.com/docs/en/skills">SKILL.md</a> bundle, one-command install via <code>npx skills</code>.
</p>
<div align="center">

[![npm version](https://badgen.net/npm/v/telegram-agent)](https://www.npmjs.com/package/telegram-agent)
[![License](https://img.shields.io/npm/l/telegram-agent)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

</div>

Plugs your AI coding agent into a real Telegram user account via [MTProto](https://core.telegram.org/mtproto). The agent reads `SKILL.md` only when your prompt mentions Telegram — the rest of the time your context budget is untouched. Standalone: no MCP server in the loop, talks to Telegram directly through gram.js.

**Use it to:** read dialogs · global message search · send / edit / forward / react · tag Saved Messages with reaction-tags (Premium) · moderate channels · send & download files · call raw MTProto methods. All against your real user account — no bot needed.

> [!WARNING]
> This signs in as a real Telegram user (not a bot). Sessions live in `~/.telegram-agent/`. Treat that directory like a password.

## Why this exists

The standard way to give an agent Telegram access is an [MCP server](https://github.com/beautyfree/mcp-telegram) that loads ~12,700 tokens of tool schemas into the model's system prompt on every turn — whether you mention Telegram or not. `telegram-agent` takes the opposite approach: the agent client scans short skill *descriptions* (~50 tokens) and only loads the full instructions if your request matches.

| Transport | When to use | Context cost (idle) | Per-task cost |
| --- | --- | --- | --- |
| **MCP server** ([`mcp-telegram`](https://github.com/beautyfree/mcp-telegram)) | Any MCP client; hosted runtimes; ChatGPT Apps SDK | ~12,700 tokens | covered by tool schemas |
| **Skill bundle** (this package) | Claude Code · Codex CLI · Cursor · Gemini CLI · Cline · Windsurf · OpenCode · 40+ more | **0 tokens** until matched | ~250 tokens active |

The two packages share the on-disk session store (`~/.telegram-agent/`) — sign in once, use either or both.

## Prerequisites

- Node.js `>=20`
- Telegram API credentials from [my.telegram.org/apps](https://my.telegram.org/apps) — `api_id` and `api_hash`

## Install

One command. Drop the skill into your agent — it bootstraps the `telegram-agent` CLI, asks for your API credentials, and runs `login` itself on the first Telegram request.

```bash
npx skills add beautyfree/telegram-agent -a claude-code -g
```

That's it. The next time you say "check my Telegram", the agent will:

1. Run `npm i -g telegram-agent` if the binary isn't on `$PATH`.
2. Ask you once for `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` from [my.telegram.org/apps](https://my.telegram.org/apps) and persist them in your shell rc.
3. Run `telegram-agent login` — opens a local browser → phone → SMS code → 2FA. Session caches in `~/.telegram-agent/` (shared with [`mcp-telegram`](https://github.com/beautyfree/mcp-telegram) if you also run the MCP server).

Prefer to do step 1–3 yourself, ahead of time? Run:

```bash
npm install -g telegram-agent
export TELEGRAM_API_ID=123456
export TELEGRAM_API_HASH=abc...
telegram-agent login
```

### Picking the install method

Two ways to drop the skill in. Both end with the same `SKILL.md` in the right place on disk.

#### Option A — `npx skills add` (universal, 54+ agents) **[recommended]**

[`npx skills`](https://github.com/vercel-labs/skills) is the de-facto installer for the universal SKILL.md format. It supports 54 agent clients (`claude-code`, `codex`, `cursor`, `gemini-cli`, `cline`, `windsurf`, `opencode`, `continue`, `roo`, `goose`, `aider-desk`, `kilo`, `warp`, …).

```bash
npx skills add beautyfree/telegram-agent -a claude-code -g
npx skills add beautyfree/telegram-agent -a cursor -a codex -g
npx skills add beautyfree/telegram-agent                       # interactive picker
```

Flags worth knowing:

| Flag | Purpose |
| --- | --- |
| `-a, --agent <name>` | Target a specific agent (repeatable). Run `npx skills add beautyfree/telegram-agent --list` to see the full agent list. |
| `-g, --global` | Install to `$HOME/...` instead of the current project. |
| `-y, --yes` | Skip confirmation prompts (CI-friendly). |
| `--copy` | Copy files instead of symlinking (symlink is the default — updates flow through). |

#### Option B — your agent's native command

Every supported agent has a native plugin/skill install command. Use it if you prefer the standard client UX or want the agent's own update flow. Click through for the exact incantation:

<details>
<summary><b>Claude Code</b></summary>

```
/plugin marketplace add beautyfree/telegram-agent
/plugin install telegram@telegram-agent
/reload-plugins
```

Drops the bundle under `~/.claude/plugins/cache/`. Subsequent `/plugin update` pulls new versions.
</details>

<details>
<summary><b>Codex CLI</b></summary>

Inside Codex:

```
$skills
$telegram
```

Or drop the bundle manually with the universal installer:

```bash
npx skills add beautyfree/telegram-agent -a codex -g
```

Codex picks up `~/.agents/skills/telegram/` on the next session.
</details>

<details>
<summary><b>Cursor</b></summary>

In Cursor:

```
/add-plugin
```

Point it at this repo (`beautyfree/telegram-agent`). The repo already contains a `.cursor-plugin/plugin.json` so Cursor installs it as a native plugin with the skill and the optional MCP server (`mcp.json`) wired in.
</details>

<details>
<summary><b>Gemini CLI</b></summary>

```bash
gemini extensions install https://github.com/beautyfree/telegram-agent
```

Picks up `gemini-extension.json` from the repo and wires both the skill and the optional MCP server.
</details>

<details>
<summary><b>Cline</b></summary>

```bash
npx skills add beautyfree/telegram-agent -a cline -g
```

Drops the bundle under `~/.clinerules/telegram/`. Cline's rules engine reads it on every prompt and only follows the body when the description matches.
</details>

<details>
<summary><b>Windsurf</b></summary>

```bash
npx skills add beautyfree/telegram-agent -a windsurf
```

Project-scoped — run inside each project where you want Telegram available. Writes `./.windsurf/rules/telegram.md` with `trigger: model_decision`.
</details>

<details>
<summary><b>Goose</b></summary>

Goose uses YAML recipes, not skill files. Wire `telegram-agent` (the binary) into a recipe's `extensions:` section if you want it inside a Goose flow. For the MCP path, use [`mcp-telegram`](https://github.com/beautyfree/mcp-telegram) directly inside a recipe instead.
</details>

### 3. Use it from any agent

Open Claude Code / Codex / Cursor / Gemini / Cline / Windsurf and just ask:

> *"summarize @hackernews from today"*
> *"tag my Saved Messages by topic"*
> *"send 'hello' to @friend"*
> *"find that link about Cloudflare Workers in my chats"*

The agent reads `SKILL.md`, shells out to `telegram-agent <command>`, parses JSON, responds.

## CLI surface

`telegram-agent` exposes the whole Telegram surface from one command. JSON to stdout — pipe through `jq`.

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

```bash
telegram-agent dialogs --limit 10 | jq '.[] | {title, unreadCount}'
telegram-agent search-global "stripe pricing" --limit 20
telegram-agent saved tags
telegram-agent react me 12345 🧠                # tag a Saved Message
telegram-agent saved search --tag 🧠 --limit 50 # pull everything tagged "🧠"
```

Run `telegram-agent help` for the full flag reference.

## How it works

1. **Session** — `telegram-agent login` opens a tiny local browser page for phone → SMS → 2FA, then stores the session at `~/.telegram-agent/`. Shared on-disk with [`mcp-telegram`](https://github.com/beautyfree/mcp-telegram).

2. **Skill bundle** — one `SKILL.md` (frontmatter `name` + `description`, ~250 tokens) with the full command list inline, plus narrow lazy-loaded references:
   - `references/installation.md` — install, authentication, daemon storage, troubleshooting
   - `references/playbooks/saved-tags.md` — categorize Saved Messages with reaction-tags
   - `references/playbooks/digest.md` — batch summary of a channel or DM
   - `references/playbooks/moderation.md` — bans, restrictions, admin-rights bitmasks
   - `references/playbooks/outreach.md` — careful cold/warm DM campaigns with caps + cooldowns

   The agent reads `SKILL.md` only when your prompt matches its description. References load on-demand inside that activation.

3. **CLI** — `telegram-agent` is a thin JSON-first wrapper around [gram.js](https://github.com/gram-js/gramjs). No MCP server in the loop.

4. **Distribution** — the repo follows the [universal SKILL.md layout](https://code.claude.com/docs/en/skills): `skills/telegram/SKILL.md` plus per-client marketplace manifests (`.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `gemini-extension.json`). That's what makes both `npx skills add beautyfree/telegram-agent` and the agent-native commands work out of the box.

## Compatibility matrix

| Agent | Recommended install | Skill format | Install target |
| --- | --- | --- | --- |
| Claude Code | `npx skills add … -a claude-code -g` or `/plugin marketplace add` | Universal SKILL.md | `~/.claude/skills/telegram/` |
| Codex CLI | `npx skills add … -a codex -g` | Universal SKILL.md | `~/.agents/skills/telegram/` |
| Cursor | `/add-plugin` (or `npx skills add … -a cursor`) | Native plugin | `~/.cursor/plugins/local/telegram/` |
| Gemini CLI | `gemini extensions install …` | Extension | `~/.gemini/skills/telegram/` |
| Cline | `npx skills add … -a cline -g` | Rule pack | `~/.clinerules/telegram/` |
| Windsurf | `npx skills add … -a windsurf` (project) | Rule | `.windsurf/rules/telegram.md` |
| OpenCode / Continue / Roo / Warp / 40+ more | `npx skills add … -a <agent> -g` | Universal SKILL.md | agent-specific |
| Goose | wire `telegram-agent` into a YAML recipe | — | recipe `extensions:` |

## Environment

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `TELEGRAM_API_ID` | yes | — | From my.telegram.org/apps. Prompted on first login if unset. |
| `TELEGRAM_API_HASH` | yes | — | Same as above. |
| `TELEGRAM_AGENT_HOME` | no | `~/.telegram-agent` | State + session storage. Legacy `MCP_TELEGRAM_HOME` accepted. If `~/.mcp-telegram/` exists from a previous install, it's used automatically. |
| `TELEGRAM_AGENT_DOWNLOADS` | no | `$TELEGRAM_AGENT_HOME/downloads` | Where `download` saves files. Legacy `MCP_TELEGRAM_DOWNLOADS` accepted. |
| `LOG_LEVEL` | no | `info` | Set to `debug` for verbose stderr. |

## FAQ

**Do I need Telegram Premium?**
No. Saved Messages reaction-tags are Premium-only; everything else works on a free account.

**Bot or user account?**
User account. This is the MTProto API, not the Bot API. The agent acts as you. Treat your session like a password.

**Why do I need `npm i -g telegram-agent` if I'm installing via `npx skills`?**
`npx skills add` only drops the `SKILL.md` instructions into your agent's skill directory. The skill instructs the agent to invoke `telegram-agent` from `$PATH` — so the binary still needs to be installed. A future revision may switch the skill to invoke via `npx telegram-agent@latest` to skip this step at the cost of cold-start latency on every call.

**Is my data going somewhere?**
The session lives in `~/.telegram-agent/` on your machine. No third-party server. The CLI talks directly to Telegram's MTProto.

**What about real-time push notifications?**
The skill/CLI path is request-response. For long-poll / streaming, run [`mcp-telegram`](https://github.com/beautyfree/mcp-telegram) as the MCP server alongside — both share the same session store.

**Does it work with a Telegram Bot API token?**
No — this uses MTProto. For Bot API, you want a different package.

**Does `mcp-telegram` still work?**
Yes, unchanged. The two packages are independent and complementary. Use whichever transport fits your client, or both.

## Related

- [`mcp-telegram`](https://github.com/beautyfree/mcp-telegram) — the underlying MCP server, for clients that only speak MCP.
- [`npx skills`](https://github.com/vercel-labs/skills) — universal SKILL.md installer (54+ agents).
- [Anthropic Skills docs](https://code.claude.com/docs/en/skills) — the universal SKILL.md format spec.
- [Codex Agent Skills](https://developers.openai.com/codex/skills) — OpenAI's adoption of the same format.
- [Cursor Plugins](https://cursor.com/docs/plugins) — Cursor's native plugin system.
- [Gemini CLI Extensions](https://geminicli.com/docs/extensions/) — Google's extension manifest.
- [gram.js](https://github.com/gram-js/gramjs) — the MTProto client under the hood.
