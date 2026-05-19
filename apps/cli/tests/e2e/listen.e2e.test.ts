/**
 * End-to-end tests for the listen (streaming) command.
 * Requires a valid Telegram session and a running daemon.
 *
 * Tests use real messages (send → listen) to verify the full pipeline:
 * TDLib update → daemon SSE → CLI listen handler → NDJSON output.
 *
 * Run: bun test src/listen.e2e.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import path from 'node:path';

const CLI_ENTRY = path.resolve(import.meta.dir, '../../src/index.ts');
const TIMEOUT = 30_000;
const STREAM_TIMEOUT = 30_000;

type TgResult = {
  ok: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: dynamic CLI JSON output
  data?: any;
  error?: string;
  code?: string;
  hasMore?: boolean;
  nextOffset?: unknown;
  _raw?: string;
  _stderr?: string;
  _exitCode?: number | null;
};

/** Run a CLI command and parse JSON result */
async function tg(...args: string[]): Promise<TgResult> {
  const proc = Bun.spawn(['bun', 'run', CLI_ENTRY, '--timeout', '30', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  try {
    return { ...JSON.parse(stdout.trim()), _stderr: stderr, _exitCode: proc.exitCode };
  } catch {
    return {
      ok: false,
      error: 'Failed to parse JSON',
      _raw: stdout,
      _stderr: stderr,
      _exitCode: proc.exitCode,
    };
  }
}

/** Spawn listen in background, collect NDJSON lines incrementally */
function listenBg(...args: string[]) {
  const proc = Bun.spawn(['bun', 'run', CLI_ENTRY, 'listen', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const chunks: Uint8Array[] = [];
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  let reading = true;

  // Background reader — collects chunks as they arrive
  (async () => {
    try {
      while (reading) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } catch {}
  })();

  // Wait for the "Listening for events" stderr message — signals handler is registered
  const ready = (async () => {
    const stderrReader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
    const start = Date.now();
    let buf = '';
    while (Date.now() - start < 10_000) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      buf += Buffer.from(value).toString();
      if (buf.includes('Listening')) {
        stderrReader.releaseLock();
        return;
      }
    }
    stderrReader.releaseLock();
  })();

  return {
    getLines(): string[] {
      const text = Buffer.concat(chunks).toString();
      return text.split('\n').filter((l) => l.trim());
    },
    async waitForReady(): Promise<void> {
      await ready;
    },
    async waitForLines(count: number, timeoutMs = 10_000): Promise<string[]> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const lines = this.getLines();
        if (lines.length >= count) return lines;
        await new Promise((r) => setTimeout(r, 300));
      }
      return this.getLines();
    },
    async kill() {
      reading = false;
      proc.kill();
      try {
        reader.releaseLock();
      } catch {}
      await proc.exited;
    },
    proc,
  };
}

// --- Shared state ---
let myId: number;
/** Message IDs to clean up after all tests */
const cleanupMsgIds: number[] = [];

beforeAll(async () => {
  const me = await tg('me');
  expect(me.ok).toBe(true);
  myId = me.data.id;
}, TIMEOUT);

afterAll(async () => {
  for (const id of cleanupMsgIds) {
    await tg('action', 'delete', 'me', String(id));
  }
}, TIMEOUT);

// ─── Validation ───

describe('listen validation', () => {
  it(
    'no flags → INVALID_ARGS',
    async () => {
      const r = await tg('listen');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
      expect(r.error).toContain('--chat or --type');
    },
    TIMEOUT,
  );

  it(
    'bad --type → INVALID_ARGS',
    async () => {
      const r = await tg('listen', '--type', 'foo');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
      expect(r.error).toContain('foo');
    },
    TIMEOUT,
  );

  it(
    'bad --exclude-type → INVALID_ARGS',
    async () => {
      const r = await tg('listen', '--type', 'user', '--exclude-type', 'bar');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
      expect(r.error).toContain('bar');
    },
    TIMEOUT,
  );
});

// ─── Streaming events ───

describe('listen streaming', () => {
  it(
    'receives new_message from real send',
    async () => {
      const handle = listenBg('--chat', String(myId));

      try {
        const nonce = `listen-new-${Date.now()}`;
        const sent = await tg('action', 'send', 'me', nonce);
        expect(sent.ok).toBe(true);
        cleanupMsgIds.push(sent.data.id);

        const lines = await handle.waitForLines(1, 8000);
        expect(lines.length).toBeGreaterThanOrEqual(1);

        const events = lines.map((l) => JSON.parse(l));
        const match = events.find(
          // biome-ignore lint/suspicious/noExplicitAny: parsed JSON
          (e: any) => e.type === 'new_message' && e.message?.text === nonce,
        );
        expect(match).toBeTruthy();
        expect(match.chat_id).toBe(myId);
        expect(match.message.name).toBeString();
      } finally {
        await handle.kill();
      }
    },
    STREAM_TIMEOUT,
  );

  it(
    '--type group excludes user messages',
    async () => {
      const handle = listenBg('--type', 'group');

      try {
        // Send to Saved Messages (a user/private chat — should be excluded by --type group)
        const nonce = `listen-exclude-${Date.now()}`;
        const sent = await tg('action', 'send', 'me', nonce);
        expect(sent.ok).toBe(true);
        cleanupMsgIds.push(sent.data.id);

        // Wait briefly and verify no matching events
        await new Promise((r) => setTimeout(r, 3000));
        const lines = handle.getLines();
        const events = lines
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        const match = events.find(
          // biome-ignore lint/suspicious/noExplicitAny: parsed JSON
          (e: any) => e.type === 'new_message' && e.message?.text === nonce,
        );
        expect(match).toBeUndefined();
      } finally {
        await handle.kill();
      }
    },
    STREAM_TIMEOUT,
  );

  it(
    '--chat filter includes specific chat',
    async () => {
      const handle = listenBg('--chat', String(myId));

      try {
        const nonce = `listen-chat-${Date.now()}`;
        const sent = await tg('action', 'send', 'me', nonce);
        expect(sent.ok).toBe(true);
        cleanupMsgIds.push(sent.data.id);

        const lines = await handle.waitForLines(1, 8000);
        expect(lines.length).toBeGreaterThanOrEqual(1);

        const events = lines.map((l) => JSON.parse(l));
        const match = events.find(
          // biome-ignore lint/suspicious/noExplicitAny: parsed JSON
          (e: any) => e.type === 'new_message' && e.message?.text === nonce,
        );
        expect(match).toBeTruthy();
        expect(match.chat_id).toBe(myId);
      } finally {
        await handle.kill();
      }
    },
    STREAM_TIMEOUT,
  );

  it(
    '--chat resolves usernames and "me"',
    async () => {
      const handle = listenBg('--chat', 'me');
      await handle.waitForReady();

      try {
        const nonce = `listen-resolve-${Date.now()}`;
        const sent = await tg('action', 'send', 'me', nonce);
        expect(sent.ok).toBe(true);
        cleanupMsgIds.push(sent.data.id);

        const lines = await handle.waitForLines(1, 8000);
        expect(lines.length).toBeGreaterThanOrEqual(1);

        const events = lines.map((l) => JSON.parse(l));
        const match = events.find(
          // biome-ignore lint/suspicious/noExplicitAny: parsed JSON
          (e: any) => e.type === 'new_message' && e.message?.text === nonce,
        );
        expect(match).toBeTruthy();
      } finally {
        await handle.kill();
      }
    },
    STREAM_TIMEOUT,
  );

  it(
    '--type user receives user messages',
    async () => {
      const handle = listenBg('--type', 'user');

      try {
        const nonce = `listen-user-${Date.now()}`;
        const sent = await tg('action', 'send', 'me', nonce);
        expect(sent.ok).toBe(true);
        cleanupMsgIds.push(sent.data.id);

        const lines = await handle.waitForLines(1, 8000);
        const events = lines.map((l) => JSON.parse(l));

        // User message should appear (Saved Messages is a private/user chat)
        expect(
          events.find(
            // biome-ignore lint/suspicious/noExplicitAny: parsed JSON
            (e: any) => e.type === 'new_message' && e.message?.text === nonce,
          ),
        ).toBeTruthy();
      } finally {
        await handle.kill();
      }
    },
    STREAM_TIMEOUT,
  );
});

// ─── Daemon survival ───

describe('listen cleanup', () => {
  it(
    'daemon stays alive after listen stops',
    async () => {
      const handle = listenBg('--type', 'user');

      // Let it run briefly then kill
      await new Promise((r) => setTimeout(r, 2000));
      await handle.kill();

      // Daemon should still work
      const me = await tg('me');
      expect(me.ok).toBe(true);
      expect(me.data.id).toBeTruthy();
    },
    TIMEOUT,
  );
});
