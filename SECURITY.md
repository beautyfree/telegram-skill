# Security

## Threat model

`telegram-agent` signs in as a **real Telegram user**, not a bot. The session token that's persisted on disk is the equivalent of a logged-in device — anyone who reads it can impersonate you on Telegram, including reading your messages and sending them on your behalf. There is no second factor at use-time.

The session lives under `~/.telegram-agent/`. Treat that directory like a password file.

## What we do

| Mitigation | Where |
|---|---|
| Directory perms `0700` on `~/.telegram-agent/` and `~/.telegram-agent/sessions/` | `src/state.ts` |
| File perms `0600` on `state.json` and each persisted session field (`authKey`, `dcId`, `serverAddress`, port, entity rows) | `src/session.ts`, `src/state.ts` |
| Local-loopback HTTP for the `login` browser flow — the auth page is served from `127.0.0.1` and never traverses the network | `src/auth-browser.ts` |
| No external dependencies for storage — sessions are plain files; no SaaS, no cloud sync | by design |
| `doctor` warns if a stray `<cwd>/Users/` directory is detected (regression check against a pre-1.0.2 path leak) | `src/commands/doctor.ts` |
| `listen` runs in-process, not via the daemon, so its WebSocket lifetime is bounded by the CLI invocation | `src/cli.ts` |
| JSON-stringified payloads written via `writeFileSync` with explicit `mode` | `src/state.ts` |

## What we deliberately don't do

- **No encryption at rest.** Sessions are JSON files; anyone who can read your home directory can extract the auth key. Use disk encryption (FileVault, LUKS, BitLocker) for at-rest protection.
- **No system keychain integration.** Adding Keychain/libsecret/DPAPI is on the roadmap; it would mitigate the at-rest issue for users without full-disk encryption.
- **No token rotation.** Telegram doesn't expose a rotation primitive; sessions are invalidated only via `telegram-agent logout` or by the user terminating the device from Telegram's settings UI.
- **No supply-chain provenance check at runtime.** If you `npm i -g telegram-agent`, you're trusting the npm registry. We do not currently embed a manifest check that screams when the package metadata is impersonated. ([chigwell/telegram-mcp](https://github.com/chigwell/telegram-mcp) ships such a guard for PyPI; a similar JS-side check is on our roadmap.)

## Portable sessions

`telegram-agent session export <accountId>` prints a gram.js-compatible session string (same wire format as Telethon's `StringSession.save()`). `telegram-agent session import --string <blob>` re-hydrates it.

The exported blob **IS** the credential. Anyone with that string can sign in as you. Do not paste it into a chat. Do not commit it. Treat it like a password.

Use cases this enables:
- Docker / CI runners where `~/.telegram-agent/` is awkward to mount.
- Moving an authenticated session between machines without redoing phone → SMS → 2FA.
- Backing up a known-good session offline.

## Untrusted message content

Telegram message text and captions are **user-generated content from third parties**. The skill bundle (`skills/telegram/SKILL.md`) explicitly instructs agents to treat that content as data, never as instructions, and to require user confirmation before:

- `action delete --revoke` (deletes for everyone)
- bulk `action delete` (multiple message IDs)
- `action forward` to chats the user hasn't named
- `saved delete-history` (date-range purge of Saved Messages)
- `logout`
- destructive `invoke` calls (`channels.DeleteMessages`, `channels.KickFromChannel`, …)

If you build an integration on top of `telegram-agent`, mirror those guardrails.

## Reporting a vulnerability

Email **alex.elizarov1@gmail.com** with subject `telegram-agent security`. We aim to reply within 72 hours. Please do not file a public issue for unpatched vulnerabilities — coordinate disclosure with us so users can upgrade first.

For high-impact issues (auth bypass, token leakage, RCE in the login browser flow, etc.), a CVE will be requested and credited in the release notes.

## Where credentials live, in order

| Item | Location |
|---|---|
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | Environment, or `state.json` if you typed them into the login UI |
| Session auth key, DC, server, port | `~/.telegram-agent/sessions/<accountId>/{authKey,dcId,serverAddress,port}` |
| Account registry (phone, username, last-seen id) | `~/.telegram-agent/state.json` |
| Downloads | `~/.telegram-agent/downloads/` (overridable via `TELEGRAM_AGENT_DOWNLOADS`) |
| Daemon socket | `~/.telegram-agent/daemon.sock` |
