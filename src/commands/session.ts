/**
 * `session export` / `session import` — portable session strings.
 *
 * Format is gram.js's `StringSession.save()` output: an opaque
 * base64 blob of `{ dcId, serverAddress, port, authKey }`. Compatible
 * with Telethon-style session strings (same binary layout for the
 * authKey portion). Useful for Docker / CI / one-off agents where
 * keeping a writable `~/.telegram-agent/` is awkward.
 *
 * NOTE: The exported string IS the credential. Anyone with it can sign
 * in as you. Treat it like a password — and never paste it into a
 * shared chat or commit it.
 */
import { mkdirSync } from 'fs';
import { join } from 'path';

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

import type { Cmd } from './_shared.js';
import { fail, need, print, flagStr, flagBool } from './_shared.js';
import { FileSession } from '../session.js';
import { sessionsDir, getAccount, upsertAccount, listAccounts } from '../state.js';
import { credentialsStatus } from '../telegram.js';

function apiCreds(): { apiId: number; apiHash: string } {
  const envId = process.env.TELEGRAM_API_ID;
  const envHash = process.env.TELEGRAM_API_HASH;
  if (envId && envHash) return { apiId: parseInt(envId, 10), apiHash: envHash };
  const status = credentialsStatus();
  if (status.source === 'missing') {
    fail('Telegram API credentials are not configured. Set TELEGRAM_API_ID + TELEGRAM_API_HASH.');
  }
  // credentialsStatus reads stored creds — re-fetch by importing the
  // function that returns them. Cheaper: just bail and ask the caller
  // to set env vars before importing, which is the common case.
  fail('Set TELEGRAM_API_ID + TELEGRAM_API_HASH in the environment before importing a session.');
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (c) => chunks.push(Buffer.from(c)));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
  });
}

const exportCmd: Cmd = async (args) => {
  const id = need(args, 0, 'accountId');
  const account = getAccount(id);
  if (!account) {
    const known = listAccounts().map((a) => a.id).join(', ') || '(none)';
    fail(`Unknown account ${id}. Known: ${known}`);
  }

  const dir = join(sessionsDir, id);
  const file = new FileSession(dir);
  await file.load();

  if (!file.dcId || !file.serverAddress || !file.port || !file.authKey) {
    fail(`Session for ${id} is incomplete on disk. Run \`telegram-agent login\` to re-authorize.`);
  }

  // StringSession inherits MemorySession's public setters — we don't have to
  // touch private fields. setDC + the authKey setter populate everything
  // `save()` needs.
  const stringSession = new StringSession('');
  stringSession.setDC(file.dcId, file.serverAddress, file.port);
  stringSession.authKey = file.authKey;

  const encoded = stringSession.save();
  print({ accountId: id, phone: account.phone, username: account.username, session: encoded });
};

const importCmd: Cmd = async (args, flags) => {
  const raw = flagStr(flags, 'string') ?? (flagBool(flags, 'stdin') ? await readStdin() : undefined);
  if (!raw) {
    fail('No session string. Pass it via --string "<blob>" or --stdin.');
  }

  const { apiId, apiHash } = apiCreds();

  // Validate + parse the string by booting a transient StringSession.
  const transient = new StringSession(raw);
  await transient.load();

  // Verify the session works against Telegram and learn the account
  // identity. This is the moment of truth — a bogus or revoked string
  // surfaces here instead of writing junk to disk.
  const probe = new TelegramClient(transient, apiId, apiHash, { connectionRetries: 3 });
  await probe.connect();
  let me: any;
  try {
    me = await probe.getMe();
  } catch (err) {
    await probe.disconnect();
    fail(`Imported session failed Telegram auth: ${(err as Error).message}`);
  }
  await probe.disconnect();

  const accountId = (me as any)?.id?.toString();
  const phone = (me as any)?.phone ?? 'unknown';
  const username = (me as any)?.username as string | undefined;
  if (!accountId) fail('Could not determine account id from imported session.');

  // Persist the session to its permanent FileSession dir under the
  // canonical account id.
  const dir = join(sessionsDir, accountId);
  mkdirSync(dir, { recursive: true });
  const file = new FileSession(dir);
  await file.load();
  file.setDC(transient.dcId, transient.serverAddress!, transient.port!);
  file.authKey = transient.authKey;

  upsertAccount({ id: accountId, phone, username, telegram_id: accountId });
  print({ ok: true, accountId, phone, username, sessionDir: dir });
};

export const session = {
  export: exportCmd,
  import: importCmd,
};
