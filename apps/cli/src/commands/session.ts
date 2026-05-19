/**
 * `session export` / `session import` — portable session blobs.
 *
 *   session export                  Emit an opaque base64 blob of the current
 *                                   TDLib auth state. The blob IS the credential.
 *   session import --string <blob>  Decode and write the blob into the local
 *                                   TDLib database so the next command runs
 *                                   without phone → SMS → 2FA.
 *
 * Implementation: TDLib persists session state as a binary blob inside
 * its `tdlib_db/` directory (encrypted with the local-key passphrase
 * unless one is set, which we don't). The export format is a base64
 * tar of that directory tree — portable across machines as long as the
 * `api_id` / `api_hash` match. No live RPC required for either operation.
 *
 * NOTE: Anyone holding the exported blob can sign in as the user. Treat
 * it like a password — never paste into chat, never commit, never email.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DB_DIR } from '@tg/protocol/paths';
import type { Command } from 'commander';
import { fail, success, warn } from '../output';

function runTar(args: string[]): { stdout: Buffer; ok: boolean; stderr: string } {
  const r = spawnSync('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    stdout: r.stdout ?? Buffer.alloc(0),
    ok: r.status === 0,
    stderr: r.stderr?.toString('utf-8') ?? '',
  };
}

export function register(parent: Command): void {
  const session = parent.command('session').description('Portable session export / import');

  // --- session export ---
  session
    .command('export')
    .description(
      'Dump the current TDLib session as a base64 blob (=credential — treat as password)',
    )
    .action(() => {
      // No client needed — pure file-system snapshot of TDLib's DB dir.
      if (!existsSync(DB_DIR)) {
        fail(`No session found at ${DB_DIR}. Run \`telegram-agent login\` first.`, 'NOT_FOUND');
      }
      const r = runTar(['-C', path.dirname(DB_DIR), '-czf', '-', path.basename(DB_DIR)]);
      if (!r.ok) fail(`tar failed while exporting session: ${r.stderr.trim()}`, 'UNKNOWN');
      const blob = r.stdout.toString('base64');
      success({
        format: 'tdlib-session-tar.b64.v1',
        sessionDir: DB_DIR,
        bytes: r.stdout.length,
        blob,
      });
    });

  // --- session import ---
  session
    .command('import')
    .description('Import a previously exported session blob into the local TDLib database')
    .option('--string <blob>', 'Base64-encoded blob from `session export`')
    .option('--stdin', 'Read the blob from stdin')
    .option('--force', 'Overwrite the existing session (destructive)')
    .action(async (opts: { string?: string; stdin?: boolean; force?: boolean }) => {
      let blob = opts.string;
      if (!blob && opts.stdin) {
        const chunks: Buffer[] = [];
        for await (const c of process.stdin) chunks.push(c as Buffer);
        blob = Buffer.concat(chunks).toString('utf-8').trim();
      }
      if (!blob) fail('Pass the blob via --string "<base64>" or --stdin', 'INVALID_ARGS');

      if (existsSync(DB_DIR) && !opts.force) {
        fail(
          `A session already exists at ${DB_DIR}. Re-run with --force to overwrite, ` +
            'or `telegram-agent logout` first.',
          'PERMISSION',
        );
      }

      const tarBytes = Buffer.from(blob, 'base64');
      if (tarBytes.length === 0) fail('Decoded blob is empty — wrong format?', 'INVALID_ARGS');

      mkdirSync(path.dirname(DB_DIR), { recursive: true });
      const tmpTar = path.join(homedir(), `.telegram-agent-import-${Date.now()}.tar.gz`);
      writeFileSync(tmpTar, tarBytes, { mode: 0o600 });
      try {
        const r = spawnSync('tar', ['-C', path.dirname(DB_DIR), '-xzf', tmpTar], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (r.status !== 0) {
          fail(
            `tar failed while importing session: ${r.stderr?.toString('utf-8').trim()}`,
            'UNKNOWN',
          );
        }
      } finally {
        try {
          require('node:fs').unlinkSync(tmpTar);
        } catch {}
      }

      if (!existsSync(DB_DIR)) {
        fail(
          'Import completed but the expected session directory does not exist — blob format mismatch?',
          'UNKNOWN',
        );
      }
      warn('Session imported. Run `telegram-agent me` to verify it authenticates.');
      success({ sessionDir: DB_DIR, bytes: tarBytes.length });
    });
}
