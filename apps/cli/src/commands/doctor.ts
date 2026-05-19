import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  APP_DIR,
  CREDENTIALS_FILE,
  findTdjsonPath,
  getInstalledTdjsonPath,
  PID_FILE,
  PORT_FILE,
} from '@tg/protocol/paths';
import type { Command } from 'commander';

type Status = 'ok' | 'FAIL' | '-';

interface Check {
  name: string;
  status: Status;
  detail: string;
}

function getDaemonPid(): number | null {
  try {
    const raw = readFileSync(PID_FILE, 'utf-8').trim();
    const pid = Number(raw);
    if (Number.isNaN(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function getDaemonPort(): number | null {
  try {
    const raw = readFileSync(PORT_FILE, 'utf-8').trim();
    const port = Number(raw);
    if (port > 0 && port < 65536) return port;
  } catch {
    // Port file doesn't exist or is unreadable
  }
  return null;
}

function checkBinary(): Check {
  return { name: 'Binary', status: 'ok', detail: '' };
}

function checkTdlib(): Check {
  const found = findTdjsonPath();
  if (found) {
    return { name: 'TDLib', status: 'ok', detail: found };
  }
  return { name: 'TDLib', status: 'FAIL', detail: `${getInstalledTdjsonPath()} not found` };
}

function checkConfig(): Check {
  // 1. Environment variables
  if (process.env.TG_API_ID && process.env.TG_API_HASH) {
    return { name: 'Config', status: 'ok', detail: 'credentials from env' };
  }

  // 2. Credentials file
  if (existsSync(CREDENTIALS_FILE)) {
    return { name: 'Config', status: 'ok', detail: 'credentials found' };
  }

  // 3. App data dir .env
  const appEnv = path.join(APP_DIR, '.env');
  if (existsSync(appEnv)) {
    return { name: 'Config', status: 'ok', detail: 'credentials found' };
  }

  // 4. Built-in credentials (compiled binary)
  if (process.env.TG_BUILTIN_API_ID && process.env.TG_BUILTIN_API_HASH) {
    return { name: 'Config', status: 'ok', detail: 'built-in credentials' };
  }

  return { name: 'Config', status: 'FAIL', detail: 'no credentials found' };
}

function checkDaemon(): Check {
  const pid = getDaemonPid();
  if (pid) {
    const port = getDaemonPort();
    const portInfo = port ? ` on port ${port}` : '';
    return { name: 'Daemon', status: 'ok', detail: `running (PID ${pid}${portInfo})` };
  }
  return { name: 'Daemon', status: '-', detail: 'not running' };
}

export function register(parent: Command): void {
  parent
    .command('doctor')
    .description('Verify installation is complete')
    .action(() => {
      const version = process.env.TG_VERSION ?? '0.0.0-dev';
      const checks: Check[] = [checkBinary(), checkTdlib(), checkConfig(), checkDaemon()];

      console.log(`\ntelegram-agent v${version}\n`);

      const nameWidth = 10;
      const statusWidth = 6;

      for (const check of checks) {
        const name = check.name.padEnd(nameWidth);
        const status = check.status === 'ok' ? 'ok' : check.status;
        const statusStr = status.padEnd(statusWidth);
        const detail = check.detail ? `${check.detail}` : '';
        console.log(`  ${name} ${statusStr}${detail}`);
      }

      const failures = checks.filter((c) => c.status === 'FAIL');

      console.log('');
      if (failures.length === 0) {
        console.log('All checks passed.');
      } else {
        const noun = failures.length === 1 ? 'issue' : 'issues';
        const names = failures.map((f) => f.name);
        const hint =
          names.includes('TDLib') && names.includes('Config')
            ? 'TDLib library and credentials are required for the daemon.'
            : names.includes('TDLib')
              ? 'TDLib library is required for the daemon.'
              : 'Credentials are required for the daemon.';
        console.log(`${failures.length} ${noun} found. ${hint}`);
      }

      process.exit(failures.length > 0 ? 1 : 0);
    });
}
