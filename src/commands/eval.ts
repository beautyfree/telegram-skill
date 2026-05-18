/**
 * `telegram-agent eval <code>` — execute arbitrary JavaScript with a
 * connected gram.js client. Mirrors avemeva/agent-telegram.
 *
 * Always requires `--confirm`. The CLI is invoked by agents that read
 * user-generated content from Telegram; `eval` is exactly the kind of
 * primitive a prompt-injection wants to reach. The confirm gate forces
 * an out-of-band signal from the human.
 *
 * Scope injected into the evaluated code:
 *   - `client` — connected gram.js TelegramClient
 *   - `Api`    — gram.js Api namespace
 *   - `fs`     — node:fs (for one-off file I/O)
 *   - `path`   — node:path
 *   - `success(data)` — print `{ ok: true, ...data }` to stdout
 *   - `fail(msg, code?)` — emit standard error envelope and exit 1
 *   - `strip(value)`   — drop undefined / null / empty fields recursively
 *
 * Input sources, in priority:
 *   --file <path>     read from file
 *   --stdin           read from stdin (heredoc)
 *   positional args   joined with spaces
 *
 * Usage:
 *   echo 'const me = await client.invoke(new Api.users.GetUsers({ id: [new Api.InputUserSelf()] }));
 *         success({ name: me[0].firstName })' | telegram-agent eval --stdin --confirm
 */

import * as fs from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Api } from 'telegram';

import type { Cmd } from './_shared.js';
import { fail, flagBool, flagStr, ok, print, withClient } from './_shared.js';

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (c) => chunks.push(Buffer.from(c)));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trimEnd()));
  });
}

/** Drop undefined/null/empty fields recursively for the evaluated body. */
function strip(value: any): any {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'string' && v.length === 0) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return value;
}

function success(extra: Record<string, any> = {}): void {
  print({ ok: true, ...strip(extra) });
}

export const evalCmd: Cmd = async (args, flags) => {
  if (!flagBool(flags, 'confirm')) {
    fail(
      'eval executes arbitrary JavaScript against a logged-in Telegram session. ' +
        'Re-run with --confirm if you really mean it. The confirm gate is mandatory because ' +
        'untrusted message content can reach the agent loop.',
      'PERMISSION',
    );
  }

  // Source the code from --file > --stdin > positional.
  let code: string;
  const filePath = flagStr(flags, 'file');
  if (filePath) {
    if (!existsSync(filePath)) fail(`File not found: ${filePath}`, 'NOT_FOUND');
    code = readFileSync(filePath, 'utf-8');
    if (!code) fail(`File is empty: ${filePath}`, 'INVALID_ARGS');
  } else if (flagBool(flags, 'stdin')) {
    code = await readStdin();
    if (!code) fail('No code received from stdin', 'INVALID_ARGS');
  } else if (args.length > 0) {
    code = args.join(' ');
  } else {
    fail(
      'No code provided. Pass code as a positional argument, via --stdin (heredoc), or with --file.',
      'INVALID_ARGS',
    );
  }

  await withClient(flags, async (client) => {
    const fn = new Function(
      'client',
      'Api',
      'success',
      'fail',
      'strip',
      'fs',
      'path',
      `return (async () => { ${code} })()`,
    );
    const result = await fn(client, Api, success, fail, strip, fs, path);
    // If the body returned a value and didn't already call success(),
    // emit it as the payload.
    if (result !== undefined) {
      try {
        ok({ result: strip(result) });
      } catch {
        fail('eval returned a non-serializable value', 'INVALID_ARGS');
      }
    }
  });
};
