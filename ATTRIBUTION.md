# Attribution

`telegram-agent` (≥2.0.0) is a fork of [**avemeva/kurier**](https://github.com/avemeva/kurier) — specifically the `apps/cli`, `apps/daemon`, and `packages/protocol` workspaces. We retain the original GPL-3.0 license and all upstream copyright notices.

## Upstream

- **Project:** [avemeva/kurier](https://github.com/avemeva/kurier)
- **Original CLI binary:** `agent-telegram` (we rebranded to `telegram-agent`)
- **License:** [GPL-3.0-only](https://www.gnu.org/licenses/gpl-3.0.html)
- **Copyright:** © 2024–2026 the avemeva/kurier authors. See file-level headers in `apps/cli/src/`, `apps/daemon/src/`, and `packages/protocol/src/` for individual attributions.

## What we changed

- Rebranded the binary, npm package, default storage path (`~/.kurier/` → `~/.telegram-agent/`), and human-facing identifiers.
- Added the `saved` reaction-tags command group (Telegram Premium feature) for categorizing Saved Messages.
- Added `session export` / `session import` for portable session strings (Telethon-compatible serialization).
- Added directory + file permission hardening (`chmod 700` on the state dir, `chmod 600` on persisted secrets).
- Added a [`SECURITY.md`](./SECURITY.md) threat model + reporting flow.
- Repackaged distribution for our `npm` namespace with the universal SKILL.md bundle (`skills/telegram/`) for AI coding agents.

## License

Because this is a derivative work of GPL-3.0 code, `telegram-agent` is itself GPL-3.0-only. See [`LICENSE`](./LICENSE) for the full text.

If you only need the **skill bundle** (the SKILL.md + references in `skills/telegram/`) without the CLI source, the skill files themselves are GPL-3.0 because they're distributed in this repo; clean-room equivalents that drive any Telegram CLI under any license are welcome.

## Pre-2.0 history

Versions ≤1.0.12 of this package were built on [gram.js](https://github.com/gram-js/gramjs) under the MIT license — that codebase lives on the `legacy-gramjs` branch / tag `v1.0.12`. 2.0.0 is a complete engine swap to TDLib (via [tdl](https://github.com/Bannerets/tdl) + [prebuilt-tdlib](https://github.com/Bannerets/prebuilt-tdlib)) and a license change to GPL-3.0 to comply with the upstream fork.
