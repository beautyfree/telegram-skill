/**
 * `telegram-agent doctor` — self-check.
 *
 * Reports JSON with one row per check:
 *   { check, status: "ok" | "warn" | "fail", detail }
 *
 * Inspired by avemeva's doctor command. We don't have a native TDLib
 * dependency here, so we skip that check; the rest applies.
 */
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { Cmd } from './_shared.js';
import { listAccounts } from '../state.js';
import { credentialsStatus, clientForAccount } from '../telegram.js';
import { daemonSocketPath, isDaemonRunning } from '../daemon/socket.js';
import { print, flagStr } from './_shared.js';

const VERSION = '1.0.0';

interface Check {
  check: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

export const doctor: Cmd = async (_, flags) => {
  const checks: Check[] = [];

  // 1. Node version
  const nodeVer = process.versions.node;
  const nodeMajor = Number(nodeVer.split('.')[0]);
  checks.push({
    check: 'node',
    status: nodeMajor >= 20 ? 'ok' : 'fail',
    detail: `v${nodeVer} (need >=20)`,
  });

  // 2. Telegram API credentials
  const creds = credentialsStatus();
  checks.push({
    check: 'credentials',
    status: creds.source === 'missing' ? 'fail' : 'ok',
    detail:
      creds.source === 'missing'
        ? 'Set TELEGRAM_API_ID + TELEGRAM_API_HASH, or run `telegram-agent login`.'
        : `${creds.source} (api_id=${creds.api_id_masked ?? '????'})`,
  });

  // 3. Session presence
  const all = listAccounts();
  if (all.length === 0) {
    checks.push({ check: 'session', status: 'fail', detail: 'No account signed in. Run `telegram-agent login`.' });
  } else {
    const which = flagStr(flags, 'account') ?? all[0].id;
    try {
      const client = await clientForAccount(which);
      // Cheap call to confirm the session works.
      const me = await client.getMe();
      checks.push({
        check: 'session',
        status: 'ok',
        detail: `signed in as ${(me as any)?.username ? '@' + (me as any).username : (me as any)?.phone} (id ${which})`,
      });
    } catch (err) {
      checks.push({
        check: 'session',
        status: 'fail',
        detail: `${which}: ${(err as Error).message}. Run \`telegram-agent login\` to refresh.`,
      });
    }
  }

  // 4. State directory
  const stateDir = join(homedir(), '.telegram-agent');
  const legacy = join(homedir(), '.mcp-telegram');
  if (existsSync(stateDir)) {
    checks.push({ check: 'state-dir', status: 'ok', detail: stateDir });
  } else if (existsSync(legacy)) {
    checks.push({ check: 'state-dir', status: 'warn', detail: `using legacy ${legacy} — consider \`mv ${legacy} ${stateDir}\`` });
  } else {
    checks.push({ check: 'state-dir', status: 'warn', detail: `not created yet (will be on first login)` });
  }

  // 5. Daemon (optional speedup, not a failure if absent)
  const sock = daemonSocketPath();
  const daemon = await isDaemonRunning();
  checks.push({
    check: 'daemon',
    status: daemon ? 'ok' : 'warn',
    detail: daemon
      ? `running at ${sock}`
      : `not running — first call will be slower. Start with \`telegram-agent daemon start\`.`,
  });

  // 6. Stray session leak — historical bug where gram.js's bundled
  // StoreSession wrote URL-encoded absolute paths into <cwd>/Users/...
  // Fixed by switching to FileSession, but warn if an old leak is still
  // sitting under the current cwd so the user can `rm -rf Users/`.
  const strayLeak = join(process.cwd(), 'Users');
  if (existsSync(strayLeak)) {
    checks.push({
      check: 'session-leak',
      status: 'warn',
      detail: `Stray ${strayLeak} directory detected — leftover from a pre-1.0.1 session-storage bug. Safe to \`rm -rf "${strayLeak}"\`.`,
    });
  }

  // 7. Multiple accounts hint
  if (all.length > 1) {
    checks.push({
      check: 'accounts',
      status: 'warn',
      detail: `${all.length} accounts signed in (${all.map((a) => a.username || a.phone).join(', ')}). Pass --account <id> per call.`,
    });
  }

  const overall = checks.find((c) => c.status === 'fail') ? 'fail' : 'ok';
  print({ ok: overall === 'ok', version: VERSION, checks });
};
