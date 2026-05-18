/**
 * Session-management commands: login, logout, accounts, me.
 *
 * These are the only commands that touch the auth-browser. Everything else
 * assumes a session already exists at `~/.telegram-agent/`.
 */

import { runBrowserLogin } from '../auth-browser.js';
import { listAccounts } from '../state.js';
import { logoutAccount } from '../telegram.js';
import type { Cmd } from './_shared.js';
import { need, ok, print, serializeEntity, withClient } from './_shared.js';

export const login: Cmd = async () => {
  const account = await runBrowserLogin();
  print({ ok: true, account });
};

export const logout: Cmd = async (args) => {
  const id = need(args, 0, 'accountId');
  await logoutAccount(id);
  ok({ accountId: id });
};

export const accounts: Cmd = async () => {
  print(listAccounts().map((a) => ({ id: a.id, phone: a.phone, username: a.username })));
};

export const me: Cmd = async (_, flags) => {
  await withClient(flags, async (client) => {
    const meEntity = await client.getMe();
    print(serializeEntity(meEntity));
  });
};
