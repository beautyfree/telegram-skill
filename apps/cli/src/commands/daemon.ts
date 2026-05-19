import { existsSync, readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { ensureDaemon, getDaemonPid, LOG_FILE, spawnDaemon } from '../daemon';
import { fail, success } from '../output';

export function register(parent: Command): void {
  const daemon = parent.command('daemon').description('Daemon lifecycle management');

  daemon
    .command('start')
    .description('Start the background daemon')
    .action(async () => {
      const existingPid = getDaemonPid();
      if (existingPid) {
        success({ already_running: true, pid: existingPid });
      } else {
        spawnDaemon();
        const { url } = await ensureDaemon();
        const pid = getDaemonPid();
        if (url && pid) {
          success({ started: true, pid });
        } else {
          fail('Failed to start daemon', 'UNKNOWN');
        }
      }
      process.exit(0);
    });

  daemon
    .command('stop')
    .description('Stop the background daemon')
    .action(() => {
      const pid = getDaemonPid();
      if (pid) {
        process.kill(pid, 'SIGTERM');
        success({ stopped: true, pid });
      } else {
        fail('Daemon not running', 'NOT_FOUND');
      }
      process.exit(0);
    });

  daemon
    .command('status')
    .description('Check if daemon is running')
    .action(() => {
      const pid = getDaemonPid();
      if (pid) {
        success({ running: true, pid });
      } else {
        success({ running: false });
      }
      process.exit(0);
    });

  daemon
    .command('log')
    .description('Show last 20 lines of daemon log')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => {
      if (existsSync(LOG_FILE)) {
        const log = readFileSync(LOG_FILE, 'utf-8');
        const lines = log.trim().split('\n');
        if (opts.json) {
          success({ lines: lines.slice(-20) });
        } else {
          process.stdout.write(`${lines.slice(-20).join('\n')}\n`);
        }
      } else {
        fail('No daemon log file', 'NOT_FOUND');
      }
      process.exit(0);
    });
}
