# Installing telegram-agent

## Quick install

Any platform — Node.js 20+ required:

| Method | Command |
|--------|---------|
| npm | `npm install -g telegram-agent` |
| Bun | `bun install -g telegram-agent` |
| pnpm | `pnpm add -g telegram-agent` |

> [!NOTE]
> `npm i -g` may need `sudo` or a Node version manager (nvm, fnm, asdf, volta) if your global prefix isn't writable by your user. Prefer a version manager — it's the cleanest path.

## Verify installation

```bash
telegram-agent --version    # Prints version (e.g. 1.0.0)
telegram-agent doctor       # Health check: creds, session, state dir, daemon
```

### What `doctor` checks

| Check | What it verifies | If it fails |
|-------|------------------|-------------|
| `creds` | `TELEGRAM_API_ID` + `TELEGRAM_API_HASH` env vars are set | See [Authentication](#authentication) |
| `session` | A signed-in account exists under `~/.telegram-agent/` | Run `telegram-agent login` |
| `stateDir` | The state directory exists and is writable | Check permissions on `~/.telegram-agent/` |
| `daemon` | Background daemon socket is reachable | Not a failure — the daemon auto-spawns on first real command |

## Authentication

`telegram-agent` signs in as a **real Telegram user account** (not a bot). You need API credentials from [my.telegram.org/apps](https://my.telegram.org/apps) — they're free and tied to your phone number.

```bash
export TELEGRAM_API_ID=123456
export TELEGRAM_API_HASH=abcdef0123456789abcdef0123456789
telegram-agent login
```

Persist the env vars in your shell rc so they survive a new terminal:

```bash
# ~/.zshrc or ~/.bashrc
export TELEGRAM_API_ID=123456
export TELEGRAM_API_HASH=abcdef0123456789abcdef0123456789
```

`telegram-agent login` opens a local browser tab → phone number → SMS/Telegram code → 2FA password if enabled. The session token is cached under `~/.telegram-agent/`.

```bash
telegram-agent me           # Verify connection works
telegram-agent accounts     # List signed-in accounts
```

## How it works

A background daemon (Node.js + [gram.js](https://gram.js.org)) holds the MTProto WebSocket open. It auto-spawns on the first command and exits after 10 minutes of inactivity. You don't manage it manually.

```
telegram-agent <command>
       │
       ▼
   daemon (auto-spawn if missing, Unix socket IPC)
       │
       ▼
   gram.js MTProto client
       │
       ▼
   Telegram servers
```

Cold start: ~2s (connect + auth handshake). Warm (daemon up): ~200ms.

## Multi-account

Sign in to additional accounts:

```bash
telegram-agent login                  # Adds another account
telegram-agent accounts               # [{ id, phone, username }, ...]
telegram-agent me --account <id>      # Use a specific account for one call
```

Every command accepts `--account <id>` to pick which account it runs against.

## Storage layout

```
~/.telegram-agent/
├── accounts.json           # Account registry (id, phone, username)
├── sessions/<id>.session   # Per-account auth tokens (treat as passwords)
├── daemon.sock             # Unix socket (created while daemon is up)
├── daemon.pid              # PID file
└── downloads/              # Default destination for media download
```

Override the base directory with `TELEGRAM_AGENT_HOME=/some/path`. Override the downloads destination with `TELEGRAM_AGENT_DOWNLOADS=/some/path`.

Back-compat: if `~/.telegram-agent/` doesn't exist but a legacy `~/.mcp-telegram/` does, it's used automatically — migrating users don't need to re-authenticate.

## Troubleshooting

### `command not found: telegram-agent`

The global npm bin directory isn't on your `$PATH`. Fix:

```bash
npm config get prefix    # Find your prefix
# Add <prefix>/bin to $PATH in your shell rc
```

Or reinstall through a version manager (`nvm`, `fnm`, `asdf`, `volta`) that puts the bin dir on `$PATH` automatically.

### `creds: false` after exporting env vars

Env vars were exported in a different shell or you exported them after starting the daemon. Restart the daemon:

```bash
telegram-agent daemon stop
telegram-agent daemon start
```

Or use `--no-daemon` to force in-process execution that picks up the current shell's env.

### `Session expired for <id>`

Telegram revoked the session (idle too long, password change, manual logout from another device). Re-login:

```bash
telegram-agent logout <id>
telegram-agent login
```

### Daemon won't start

```bash
telegram-agent daemon status   # { running, pid, socket, idleTimeoutMs }
telegram-agent daemon stop     # Kill stuck instance
rm ~/.telegram-agent/daemon.sock ~/.telegram-agent/daemon.pid   # Last resort
telegram-agent daemon start
```

The daemon binds a Unix socket, not a TCP port, so there's no port conflict to worry about — only stale socket / PID files.

### Browser tab for `login` doesn't open

`telegram-agent login` runs a local HTTP server and prints the URL. If your browser doesn't open automatically, copy the URL from the terminal and open it yourself. The page is served from `127.0.0.1` — never sent over the network.

### "FLOOD_WAIT" errors

Telegram rate-limited you. The error message includes the number of seconds to wait. Long flood-waits (>30s) are surfaced raw — back off before retrying. Bulk operations (mass DMs, large delete loops) are the usual culprits — see `playbooks/outreach.md` for caps and cooldowns.

## Uninstall

```bash
telegram-agent logout <id>           # Revoke server-side first
npm uninstall -g telegram-agent
rm -rf ~/.telegram-agent/            # Remove cached sessions
```
