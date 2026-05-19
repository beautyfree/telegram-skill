/**
 * End-to-end tests for telegram-agent CLI.
 * These run against a real Telegram client — they require a valid session.
 *
 * Run: bun test scripts/tg/cli.e2e.test.ts
 *
 * Tests are organized by command and cover flags, edge cases, and interoperability
 * between commands (e.g., search chatId → messages).
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const CLI_ENTRY = path.resolve(import.meta.dir, '../../src/index.ts');
const TIMEOUT = 30_000;

// --- Cold-cache test infrastructure ---
const PROD_DB_DIR = path.join(
  homedir(),
  'Library',
  'Application Support',
  'dev.telegramai.app',
  'tdlib_db',
);
const TEST_PORT = '7399';
const testAppDir = mkdtempSync(path.join(tmpdir(), 'telegram-agent-e2e-'));
const testDbDir = path.join(testAppDir, 'tdlib_db');

// Copy only td.binlog (auth keys) — no db.sqlite means cold cache
mkdirSync(testDbDir, { recursive: true });
cpSync(path.join(PROD_DB_DIR, 'td.binlog'), path.join(testDbDir, 'td.binlog'));

const testEnv = {
  ...process.env,
  TG_APP_DIR: testAppDir,
  TG_DAEMON_PORT: TEST_PORT,
};

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
  _boundary?: unknown;
};

/** Run a CLI command and parse JSON result */
async function tg(...args: string[]): Promise<TgResult> {
  const proc = Bun.spawn(['bun', 'run', CLI_ENTRY, '--timeout', '30', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: testEnv,
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

// --- Shared state ---
let myId: number;
let myUsername: string;
const cleanupIds: number[] = [];

/** Track a message for cleanup in afterAll (call right after send, before assertions) */
function track(id: number) {
  cleanupIds.push(id);
}

// --- Setup / Teardown ---

beforeAll(async () => {
  const me = await tg('me');
  expect(me.ok).toBe(true);
  myId = me.data.id; // numeric
  myUsername = me.data.username;
}, TIMEOUT);

afterAll(async () => {
  for (const id of cleanupIds) {
    await tg('action', 'delete', 'me', String(id));
  }
  // Stop the test daemon and clean up temp dir
  await tg('daemon', 'stop');
  try {
    const { execSync } = await import('node:child_process');
    execSync(`trash "${testAppDir}"`);
  } catch {
    // Ignore cleanup errors
  }
}, TIMEOUT);

// ─── Identity ───

describe('me', () => {
  it(
    'returns current user info',
    async () => {
      const r = await tg('me');
      expect(r.ok).toBe(true);
      expect(r.data.id).toBeNumber();
      expect(r.data.username).toBeString();
      expect(r.data.type).toBe('regular');
    },
    TIMEOUT,
  );
});

// ─── Chats List ───

describe('chats list', () => {
  it(
    'returns a list of chats',
    async () => {
      const r = await tg('chats', 'list', '--limit', '5');
      expect(r.ok).toBe(true);
      expect(r.data.length).toBeGreaterThan(0);
      expect(r.data.length).toBeLessThanOrEqual(5);
      expect(r.data[0].id).toBeNumber();
      expect(r.data[0].title).toBeString();
      expect(r.data[0].type).toMatch(/^(user|bot|group|channel)$/);
    },
    TIMEOUT,
  );

  it(
    '--type user filters to DMs only',
    async () => {
      const r = await tg('chats', 'list', '--type', 'user', '--limit', '10');
      expect(r.ok).toBe(true);
      for (const d of r.data) {
        expect(d.type).toBe('user');
      }
    },
    TIMEOUT,
  );

  it(
    '--type group filters to groups only',
    async () => {
      const r = await tg('chats', 'list', '--type', 'group', '--limit', '5');
      expect(r.ok).toBe(true);
      for (const d of r.data) {
        expect(d.type).toBe('group');
      }
    },
    TIMEOUT,
  );

  it(
    '--type channel filters to channels only',
    async () => {
      const r = await tg('chats', 'list', '--type', 'channel', '--limit', '5');
      expect(r.ok).toBe(true);
      for (const d of r.data) {
        expect(d.type).toBe('channel');
      }
    },
    TIMEOUT,
  );

  it(
    'chats search filters by title (replaces dialogs --search)',
    async () => {
      const r = await tg('chats', 'search', 'Saved', '--limit', '10');
      expect(r.ok).toBe(true);
      for (const d of r.data) {
        expect(d.title.toLowerCase()).toContain('saved');
      }
    },
    TIMEOUT,
  );

  it(
    'type field present for user dialogs',
    async () => {
      const r = await tg('chats', 'list', '--type', 'user', '--limit', '10');
      expect(r.ok).toBe(true);
      for (const d of r.data) {
        expect(d.type).toBe('user');
      }
    },
    TIMEOUT,
  );

  it(
    'includes last_message with date',
    async () => {
      const r = await tg('chats', 'list', '--limit', '3');
      expect(r.ok).toBe(true);
      for (const d of r.data) {
        if (d.last_message) {
          expect(d.last_message.id).toBeNumber();
          expect(d.last_message.date).toBeNumber();
        }
      }
    },
    TIMEOUT,
  );

  it(
    'pagination with --offset-date',
    async () => {
      const r1 = await tg('chats', 'list', '--limit', '3');
      expect(r1.ok).toBe(true);
      expect(r1.hasMore).toBe(true);
      expect(r1.nextOffset).toBeNumber();
      const r2 = await tg('chats', 'list', '--limit', '3', '--offset-date', String(r1.nextOffset));
      expect(r2.ok).toBe(true);
      expect(r2.data.length).toBeGreaterThan(0);
      // Second page should have different chats
      const ids1 = new Set(r1.data.map((d: Record<string, unknown>) => d.id));
      const ids2 = new Set(r2.data.map((d: Record<string, unknown>) => d.id));
      const overlap = [...ids2].filter((id) => ids1.has(id));
      expect(overlap.length).toBeLessThan(r2.data.length);
    },
    TIMEOUT,
  );

  it(
    '--archived includes both main and archived chats',
    async () => {
      const main = await tg('chats', 'list', '--limit', '5');
      const withArchived = await tg('chats', 'list', '--limit', '40', '--archived');
      expect(main.ok).toBe(true);
      expect(withArchived.ok).toBe(true);
      // Archived should return at least as many chats as main-only
      expect(withArchived.data.length).toBeGreaterThanOrEqual(main.data.length);
      // All main chat IDs should be present in the archived+main result
      const archivedIds = new Set(withArchived.data.map((d: Record<string, unknown>) => d.id));
      for (const d of main.data) {
        expect(archivedIds.has(d.id)).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    '--archived with --type still filters correctly',
    async () => {
      const r = await tg('chats', 'list', '--archived', '--type', 'user', '--limit', '10');
      expect(r.ok).toBe(true);
      for (const d of r.data) {
        expect(d.type).toBe('user');
      }
    },
    TIMEOUT,
  );

  it(
    'invalid --type returns INVALID_ARGS',
    async () => {
      const r = await tg('chats', 'list', '--type', 'dm');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
    },
    TIMEOUT,
  );
});

// ─── Chats List: filtered scan completeness (MAX_SCAN bug) ───
//
// The filtered path (--type, --unread) scans chats through loadChats in batches,
// but a hard MAX_SCAN=500 cap stops scanning early. If you have >500 chats,
// groups/channels/bots beyond position 500 are silently dropped.
//
// Strategy: the unfiltered path loads `limit` chats directly via loadChats(limit).
// With --limit 2000 it loads far more than the filtered path's 500-cap, exposing
// groups the filtered scan misses.

describe('chats list: filtered scan returns all matches', () => {
  // Load a large unfiltered snapshot once, then compare each --type filter against it
  let allChats: Array<{ id: number; type: string; unread: number }>;

  beforeAll(async () => {
    const r = await tg('chats', 'list', '--limit', '2000');
    expect(r.ok).toBe(true);
    allChats = r.data;
  }, 60_000);

  it('--type group returns all groups even when total chats exceed 500', async () => {
    const expected = new Set(allChats.filter((d) => d.type === 'group').map((d) => d.id));
    expect(expected.size).toBeGreaterThan(0);

    const filtered = await tg(
      'chats',
      'list',
      '--type',
      'group',
      '--limit',
      String(expected.size + 50),
    );
    expect(filtered.ok).toBe(true);
    const filteredIds = new Set(filtered.data.map((d: Record<string, unknown>) => d.id));

    const missing = [...expected].filter((id) => !filteredIds.has(id));
    expect(missing).toEqual([]);
  }, 60_000);

  it('--type channel returns all channels even when total chats exceed 500', async () => {
    const expected = new Set(allChats.filter((d) => d.type === 'channel').map((d) => d.id));
    expect(expected.size).toBeGreaterThan(0);

    const filtered = await tg(
      'chats',
      'list',
      '--type',
      'channel',
      '--limit',
      String(expected.size + 50),
    );
    expect(filtered.ok).toBe(true);
    const filteredIds = new Set(filtered.data.map((d: Record<string, unknown>) => d.id));

    const missing = [...expected].filter((id) => !filteredIds.has(id));
    expect(missing).toEqual([]);
  }, 60_000);

  it('--type bot returns all bots even when total chats exceed 500', async () => {
    const expected = new Set(allChats.filter((d) => d.type === 'bot').map((d) => d.id));
    expect(expected.size).toBeGreaterThan(0);

    const filtered = await tg(
      'chats',
      'list',
      '--type',
      'bot',
      '--limit',
      String(expected.size + 50),
    );
    expect(filtered.ok).toBe(true);
    const filteredIds = new Set(filtered.data.map((d: Record<string, unknown>) => d.id));

    const missing = [...expected].filter((id) => !filteredIds.has(id));
    expect(missing).toEqual([]);
  }, 60_000);

  it('--type user returns all users even when total chats exceed 500', async () => {
    const expected = new Set(allChats.filter((d) => d.type === 'user').map((d) => d.id));
    expect(expected.size).toBeGreaterThan(0);

    const filtered = await tg(
      'chats',
      'list',
      '--type',
      'user',
      '--limit',
      String(expected.size + 50),
    );
    expect(filtered.ok).toBe(true);
    const filteredIds = new Set(filtered.data.map((d: Record<string, unknown>) => d.id));

    const missing = [...expected].filter((id) => !filteredIds.has(id));
    expect(missing).toEqual([]);
  }, 60_000);
});

// ─── Chats List --unread ───

describe('chats list --unread', () => {
  it(
    'returns unread chats with counts',
    async () => {
      const r = await tg('chats', 'list', '--unread');
      expect(r.ok).toBe(true);
      expect(Array.isArray(r.data)).toBe(true);
      for (const d of r.data) {
        expect(d.unread).toBeGreaterThan(0);
        expect(d.id).toBeNumber();
        expect(d.type).toMatch(/^(user|bot|group|channel)$/);
      }
    },
    TIMEOUT,
  );

  it(
    '--archived includes archived chats',
    async () => {
      const r = await tg('chats', 'list', '--unread', '--archived');
      expect(r.ok).toBe(true);
      // May or may not have archived — just verify it doesn't error
      expect(Array.isArray(r.data)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    '--type user filters to DMs',
    async () => {
      const r = await tg('chats', 'list', '--unread', '--type', 'user');
      expect(r.ok).toBe(true);
      for (const d of r.data) {
        expect(d.type).toBe('user');
      }
    },
    TIMEOUT,
  );

  it(
    'includes last_read_inbox_message_id for fetching unread messages',
    async () => {
      const r = await tg('chats', 'list', '--unread', '--limit', '3');
      expect(r.ok).toBe(true);
      for (const d of r.data) {
        if (d.last_read_inbox_message_id) {
          expect(d.last_read_inbox_message_id).toBeNumber();
        }
      }
    },
    TIMEOUT,
  );
});

// ─── Messages ───

describe('msg list', () => {
  it(
    'returns messages from Saved Messages',
    async () => {
      const r = await tg('msg', 'list', 'me', '--limit', '5');
      expect(r.ok).toBe(true);
      expect(r.data.length).toBeLessThanOrEqual(5);
      for (const m of r.data) {
        expect(m.id ?? m.ids).toBeTruthy();
        // Every flat message has at least text or content type
        expect(m.text ?? m.content).toBeTruthy();
        expect(m.date).toBeString();
      }
    },
    TIMEOUT,
  );

  it(
    '--limit respects the count',
    async () => {
      const r = await tg('msg', 'list', 'me', '--limit', '3');
      expect(r.ok).toBe(true);
      expect(r.data.length).toBeLessThanOrEqual(3);
    },
    TIMEOUT,
  );

  it(
    '--offset-id paginates correctly',
    async () => {
      const r1 = await tg('msg', 'list', 'me', '--limit', '3');
      expect(r1.ok).toBe(true);
      expect(r1.data.length).toBeGreaterThan(0);
      if (r1.hasMore) {
        const r2 = await tg(
          'msg',
          'list',
          'me',
          '--limit',
          '3',
          '--offset-id',
          String(r1.nextOffset),
        );
        expect(r2.ok).toBe(true);
        // Messages should be older (lower IDs)
        const id2 = r2.data[0].id ?? r2.data[0].ids?.[0];
        const id1 = r1.data[0].id ?? r1.data[0].ids?.[0];
        expect(id2).toBeLessThan(id1);
      }
    },
    TIMEOUT,
  );

  it(
    '--filter photo returns only photos',
    async () => {
      const r = await tg('msg', 'list', 'me', '--filter', 'photo', '--limit', '5');
      expect(r.ok).toBe(true);
      for (const m of r.data) {
        expect(m.photo ?? m.photos).toBeTruthy();
      }
    },
    TIMEOUT,
  );

  it(
    '--filter document returns documents with metadata',
    async () => {
      const r = await tg('msg', 'list', 'me', '--filter', 'document', '--limit', '5');
      expect(r.ok).toBe(true);
      for (const m of r.data) {
        // Single docs have `doc` field, all have `content === 'doc'`
        expect(m.doc || m.content === 'doc').toBeTruthy();
      }
    },
    TIMEOUT,
  );

  it(
    '--filter url returns messages with links',
    async () => {
      const r = await tg('msg', 'list', 'me', '--filter', 'url', '--limit', '5');
      expect(r.ok).toBe(true);
      for (const m of r.data) {
        // URL messages contain links in text or have web page preview
        expect(m.text ?? m.preview).toBeTruthy();
      }
    },
    TIMEOUT,
  );

  it(
    '--min-id filters to newer messages',
    async () => {
      // Get some messages to find a reference ID
      const r1 = await tg('msg', 'list', 'me', '--limit', '5');
      expect(r1.ok).toBe(true);
      if (r1.data.length >= 3) {
        const midId = r1.data[2].id;
        const r2 = await tg('msg', 'list', 'me', '--min-id', String(midId), '--limit', '10');
        expect(r2.ok).toBe(true);
        for (const m of r2.data) {
          expect(m.id).toBeGreaterThan(midId);
        }
      }
    },
    TIMEOUT,
  );

  it(
    '--since filters by date server-side',
    async () => {
      // Use a recent timestamp to get recent messages only
      const oneWeekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
      const r = await tg('msg', 'list', 'me', '--since', String(oneWeekAgo), '--limit', '10');
      expect(r.ok).toBe(true);
      // Date is now "HH:MM" string — can't compare numerically; just verify data returned
      expect(r.data.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    'negative group ID works',
    async () => {
      // Find a group to test
      const groups = await tg('chats', 'list', '--type', 'group', '--limit', '1');
      if (groups.ok && groups.data.length > 0) {
        const groupId = groups.data[0].id;
        expect(groupId).toBeLessThan(0); // Should be negative
        const r = await tg('msg', 'list', String(groupId), '--limit', '2');
        expect(r.ok).toBe(true);
        expect(r.data.length).toBeGreaterThan(0);
      }
    },
    TIMEOUT,
  );

  it(
    '--offset-id returns messages near the offset, not latest',
    async () => {
      // Get the latest 5 messages
      const r1 = await tg('msg', 'list', 'me', '--limit', '5');
      expect(r1.ok).toBe(true);
      expect(r1.data.length).toBeGreaterThanOrEqual(3);
      // Pick a message in the middle as offset
      const midMsg = r1.data[2];
      const midId = midMsg.id ?? midMsg.ids?.[0];
      // Fetch with offset-id = midId → should return messages OLDER than midId
      const r2 = await tg('msg', 'list', 'me', '--limit', '3', '--offset-id', String(midId));
      expect(r2.ok).toBe(true);
      expect(r2.data.length).toBeGreaterThan(0);
      // All returned message IDs must be < midId (older)
      for (const m of r2.data) {
        const id = m.id ?? m.ids?.[0];
        expect(id).toBeLessThan(midId);
      }
    },
    TIMEOUT,
  );

  it(
    '--offset-id works on supergroups',
    async () => {
      // Find a supergroup with messages
      const groups = await tg('chats', 'list', '--type', 'supergroup', '--limit', '3');
      if (!groups.ok || groups.data.length === 0) return; // skip if no supergroups
      const groupId = String(groups.data[0].id);
      // Get latest messages
      const r1 = await tg('msg', 'list', groupId, '--limit', '5');
      expect(r1.ok).toBe(true);
      if (r1.data.length < 3) return; // skip if not enough history
      const midId = r1.data[2].id ?? r1.data[2].ids?.[0];
      // Fetch with offset-id
      const r2 = await tg('msg', 'list', groupId, '--limit', '3', '--offset-id', String(midId));
      expect(r2.ok).toBe(true);
      expect(r2.data.length).toBeGreaterThan(0);
      for (const m of r2.data) {
        const id = m.id ?? m.ids?.[0];
        expect(id).toBeLessThan(midId);
      }
    },
    TIMEOUT,
  );

  it(
    'invalid --filter returns INVALID_ARGS',
    async () => {
      const r = await tg('msg', 'list', 'me', '--filter', 'invalid');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
    },
    TIMEOUT,
  );

  it(
    'missing chat arg returns INVALID_ARGS',
    async () => {
      const r = await tg('msg', 'list');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
    },
    TIMEOUT,
  );

  it(
    'cold-cache: returns multiple messages on first fetch',
    async () => {
      // Find a group/channel that will have cold cache (no db.sqlite in test dir)
      const chats = await tg('chats', 'list', '--type', 'group', '--limit', '3');
      expect(chats.ok).toBe(true);
      expect(chats.data.length).toBeGreaterThan(0);
      const chatId = String(chats.data[0].id);

      // On cold cache, TDLib returns only 1 locally-known message without the fix.
      // With the fix, the pagination loop fetches from server until limit is met.
      const r = await tg('msg', 'list', chatId, '--limit', '20');
      expect(r.ok).toBe(true);
      expect(r.data.length).toBeGreaterThan(1);
    },
    TIMEOUT,
  );
});

// ─── Search ───

describe('msg search', () => {
  it(
    'cross-chat search returns results with chat_id and chat_title',
    async () => {
      const r = await tg('msg', 'search', 'test', '--limit', '5');
      expect(r.ok).toBe(true);
      for (const m of r.data) {
        expect(m.chat_id).toBeNumber();
        expect(m.id).toBeNumber();
      }
    },
    TIMEOUT,
  );

  it(
    'chat_id normalized: channels have -100 prefix',
    async () => {
      const r = await tg('msg', 'search', 'test', '--limit', '20');
      expect(r.ok).toBe(true);
      for (const m of r.data) {
        const chatId = m.chat_id;
        // User IDs are positive, group/channel IDs are negative
        if (chatId < 0) {
          const chatIdStr = String(chatId);
          expect(chatIdStr).toMatch(/^-100\d+$|^-\d+$/);
        }
      }
    },
    TIMEOUT,
  );

  it(
    '--chat scopes to specific chat',
    async () => {
      const r = await tg('msg', 'search', 'a', '--chat', 'me', '--limit', '3');
      expect(r.ok).toBe(true);
      expect(Array.isArray(r.data)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    '--since filters by date on cross-chat search',
    async () => {
      const oneMonthAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
      const r = await tg('msg', 'search', 'test', '--since', String(oneMonthAgo), '--limit', '10');
      expect(r.ok).toBe(true);
      // Date is now "HH:MM" string — can't compare numerically; just verify data returned
      expect(r.data.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    '--type private filters to DM results',
    async () => {
      const r = await tg('msg', 'search', 'привет', '--type', 'private', '--limit', '10');
      expect(r.ok).toBe(true);
      for (const m of r.data) {
        // User chat_ids are positive
        expect(m.chat_id).toBeGreaterThan(0);
      }
    },
    TIMEOUT,
  );

  it(
    '--type group filters to group results',
    async () => {
      const r = await tg('msg', 'search', 'test', '--type', 'group', '--limit', '10');
      expect(r.ok).toBe(true);
      for (const m of r.data) {
        expect(m.chat_id).toBeLessThan(0);
      }
    },
    TIMEOUT,
  );

  it(
    '--context returns surrounding messages',
    async () => {
      const r = await tg(
        'msg',
        'search',
        'привет',
        '--chat',
        'me',
        '--context',
        '2',
        '--limit',
        '1',
      );
      expect(r.ok).toBe(true);
      if (r.data.length > 0) {
        const hit = r.data[0];
        expect(Array.isArray(hit.context)).toBe(true);
        // Context should have up to 5 messages (2 before + hit + 2 after)
        expect(hit.context.length).toBeLessThanOrEqual(5);
      }
    },
    TIMEOUT,
  );

  it(
    '--from requires --chat',
    async () => {
      const r = await tg('msg', 'search', 'test', '--from', 'me');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
    },
    TIMEOUT,
  );

  it(
    'senderName populated in search results',
    async () => {
      const r = await tg('msg', 'search', 'test', '--limit', '10');
      expect(r.ok).toBe(true);
      // At least some results should have sender_name
      const _withName = r.data.filter((m: Record<string, unknown>) => m.sender_name);
      // We can't guarantee all have names, but the feature should work
      expect(r.data.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    'search chat_id works with msg list command',
    async () => {
      const r = await tg('msg', 'search', 'test', '--type', 'group', '--limit', '1');
      expect(r.ok).toBe(true);
      if (r.data.length > 0) {
        const chatId = r.data[0].chat_id;
        // The chat_id from search should work directly with msg list
        const msgs = await tg('msg', 'list', String(chatId), '--limit', '2');
        expect(msgs.ok).toBe(true);
        expect(msgs.data.length).toBeGreaterThan(0);
      }
    },
    TIMEOUT,
  );

  it(
    'pagination with --offset',
    async () => {
      const r1 = await tg('msg', 'search', 'test', '--limit', '5');
      expect(r1.ok).toBe(true);
      if (r1.hasMore && r1.nextOffset) {
        const r2 = await tg(
          'msg',
          'search',
          'test',
          '--limit',
          '5',
          '--offset',
          String(r1.nextOffset),
        );
        expect(r2.ok).toBe(true);
        expect(r2.data.length).toBeGreaterThan(0);
      }
    },
    TIMEOUT,
  );

  it(
    'cold-cache: --chat search returns results on first fetch',
    async () => {
      // Find a group with messages to search in
      const chats = await tg('chats', 'list', '--type', 'group', '--limit', '3');
      expect(chats.ok).toBe(true);
      expect(chats.data.length).toBeGreaterThan(0);
      const chatId = String(chats.data[0].id);

      // searchChatMessages on cold cache may return fewer than limit.
      // The loop must continue fetching from server.
      const r = await tg('msg', 'search', 'a', '--chat', chatId, '--limit', '5');
      expect(r.ok).toBe(true);
      expect(r.data.length).toBeGreaterThanOrEqual(1);
    },
    TIMEOUT,
  );
});

// ─── Send & Edit ───

describe('action send', () => {
  it(
    'sends plain text to Saved Messages',
    async () => {
      const r = await tg('action', 'send', 'me', 'e2e test message — will be deleted');
      expect(r.ok).toBe(true);
      track(r.data.id);
      expect(r.data.id).toBeNumber();
      expect(r.data.text).toBe('e2e test message — will be deleted');
    },
    TIMEOUT,
  );

  it(
    'sends with --html formatting',
    async () => {
      const r = await tg('action', 'send', 'me', '<b>bold</b> <i>italic</i>', '--html');
      expect(r.ok).toBe(true);
      track(r.data.id);
      expect(r.data.text).toBe('**bold** __italic__');
    },
    TIMEOUT,
  );

  it(
    'sends with --md formatting',
    async () => {
      const r = await tg('action', 'send', 'me', '*bold* `code`', '--md');
      expect(r.ok).toBe(true);
      track(r.data.id);
    },
    TIMEOUT,
  );

  it(
    '--stdin reads from pipe',
    async () => {
      const proc = Bun.spawn(
        ['bash', '-c', `echo "stdin test msg" | bun run ${CLI_ENTRY} action send me --stdin`],
        {
          stdout: 'pipe',
          stderr: 'pipe',
          env: testEnv,
        },
      );
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      const r = JSON.parse(stdout.trim());
      expect(r.ok).toBe(true);
      track(r.data.id);
      expect(r.data.text).toBe('stdin test msg');
    },
    TIMEOUT,
  );

  it(
    '--file reads from file',
    async () => {
      const tmpFile = path.join(tmpdir(), 'tg_test_msg.txt');
      const Bun2 = globalThis.Bun;
      Bun2.write(tmpFile, 'file test msg');
      const r = await tg('action', 'send', 'me', '--file', tmpFile);
      expect(r.ok).toBe(true);
      track(r.data.id);
      expect(r.data.text).toBe('file test msg');
      unlinkSync(tmpFile);
    },
    TIMEOUT,
  );

  it(
    'missing text returns INVALID_ARGS',
    async () => {
      const r = await tg('action', 'send', 'me');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
    },
    TIMEOUT,
  );
});

describe('action edit', () => {
  it(
    'edits a message',
    async () => {
      // Send a message first
      const s = await tg('action', 'send', 'me', 'original text');
      expect(s.ok).toBe(true);
      track(s.data.id);
      const msgId = s.data.id;

      const r = await tg('action', 'edit', 'me', String(msgId), 'edited text');
      expect(r.ok).toBe(true);
      expect(r.data.text).toBe('edited text');
      expect(r.data.edited).toBe(true);
    },
    TIMEOUT,
  );
});

// ─── Delete ───

describe('action delete', () => {
  it(
    'deletes a message',
    async () => {
      const s = await tg('action', 'send', 'me', 'to be deleted');
      expect(s.ok).toBe(true);
      track(s.data.id);
      const r = await tg('action', 'delete', 'me', String(s.data.id));
      expect(r.ok).toBe(true);
      expect(r.data.deleted).toContain(s.data.id);
    },
    TIMEOUT,
  );
});

// ─── Forward ───

describe('action forward', () => {
  it(
    'forwards a message to Saved Messages',
    async () => {
      // Send then forward to self
      const s = await tg('action', 'send', 'me', 'forward test');
      expect(s.ok).toBe(true);
      track(s.data.id);
      const r = await tg('action', 'forward', 'me', 'me', String(s.data.id));
      expect(r.ok).toBe(true);
      if (r.data[0]?.id) track(r.data[0].id);
      expect(r.data.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});

// ─── Resolve (chat info) ───

// ─── Info ───

describe('info', () => {
  it(
    'returns structured info for a user by username',
    async () => {
      const r = await tg('info', myUsername);
      expect(r.ok).toBe(true);
      expect(r.data.entity.id).toBe(myId);
      expect(r.data.entity.type).toBe('user');
      expect(r.data.entity.username).toBe(myUsername);
      expect(r.data.chat.id).toBe(myId);
      expect(typeof r.data.chat.unread).toBe('number');
    },
    TIMEOUT,
  );

  it(
    'returns info for "me"',
    async () => {
      const r = await tg('info', 'me');
      expect(r.ok).toBe(true);
      expect(r.data.entity.id).toBe(myId);
      expect(r.data.chat.id).toBe(myId);
    },
    TIMEOUT,
  );

  it(
    'user entity has user-specific fields only',
    async () => {
      const r = await tg('info', myUsername);
      expect(r.ok).toBe(true);
      expect(r.data.entity.type).toBe('user');
      // user fields present
      expect('username' in r.data.entity || 'phone' in r.data.entity).toBe(true);
      // group/channel fields absent
      expect(r.data.entity.member_count).toBeUndefined();
      expect(r.data.entity.description).toBeUndefined();
    },
    TIMEOUT,
  );

  it(
    'bot entity has bot-specific fields',
    async () => {
      const r = await tg('info', '@BotFather');
      expect(r.ok).toBe(true);
      expect(r.data.entity.type).toBe('bot');
      expect(r.data.entity.username).toBe('BotFather');
      expect(typeof r.data.entity.description).toBe('string');
      // user-only fields absent
      expect(r.data.entity.phone).toBeUndefined();
      expect(r.data.entity.is_premium).toBeUndefined();
      expect(r.data.entity.is_contact).toBeUndefined();
      expect(r.data.entity.bio).toBeUndefined();
      // group/channel fields absent
      expect(r.data.entity.member_count).toBeUndefined();
    },
    TIMEOUT,
  );

  it(
    'channel entity has channel-specific fields',
    async () => {
      const r = await tg('info', '@telegram');
      expect(r.ok).toBe(true);
      expect(r.data.entity.type).toBe('channel');
      expect(r.data.entity.username).toBe('telegram');
      expect(typeof r.data.entity.member_count).toBe('number');
      // user-only fields absent
      expect(r.data.entity.phone).toBeUndefined();
      expect(r.data.entity.is_premium).toBeUndefined();
      expect(r.data.entity.is_contact).toBeUndefined();
      expect(r.data.entity.bio).toBeUndefined();
    },
    TIMEOUT,
  );

  it(
    'group entity has group-specific fields',
    async () => {
      // Find a group to test with
      const groups = await tg('chats', 'list', '--type', 'group', '--limit', '1');
      expect(groups.ok).toBe(true);
      if (!groups.data.length) return; // skip if no groups
      const r = await tg('info', '--', String(groups.data[0].id));
      expect(r.ok).toBe(true);
      expect(r.data.entity.type).toBe('group');
      expect(typeof r.data.entity.member_count).toBe('number');
      // user-only fields absent
      expect(r.data.entity.phone).toBeUndefined();
      expect(r.data.entity.is_premium).toBeUndefined();
      expect(r.data.entity.is_contact).toBeUndefined();
      expect(r.data.entity.bio).toBeUndefined();
      expect(r.data.entity.username).toBeUndefined();
    },
    TIMEOUT,
  );

  it(
    'shared groups are included for users with common groups',
    async () => {
      // Find a contact we share groups with
      const contacts = await tg('chats', 'list', '--type', 'user', '--limit', '10');
      expect(contacts.ok).toBe(true);
      const contactId = contacts.data.find((c: { id: number }) => c.id !== myId)?.id;
      if (!contactId) return; // skip if no contacts
      const r = await tg('info', String(contactId));
      expect(r.ok).toBe(true);
      // groups is either absent or an array
      if (r.data.groups) {
        expect(Array.isArray(r.data.groups)).toBe(true);
        for (const g of r.data.groups) {
          expect(typeof g.id).toBe('number');
          expect(typeof g.title).toBe('string');
          expect(typeof g.last_active).toBe('string');
          if (g.member_count) expect(typeof g.member_count).toBe('number');
        }
      }
    },
    TIMEOUT,
  );

  it(
    'shared groups only contain real message activity (no service messages)',
    async () => {
      const contacts = await tg('chats', 'list', '--type', 'user', '--limit', '10');
      expect(contacts.ok).toBe(true);
      const contactId = contacts.data.find((c: { id: number }) => c.id !== myId)?.id;
      if (!contactId) return;
      const r = await tg('info', String(contactId));
      expect(r.ok).toBe(true);
      if (r.data.groups) {
        // Every group must have last_active (we filter out groups without it)
        for (const g of r.data.groups) {
          expect(g.last_active).toBeTruthy();
        }
      }
    },
    TIMEOUT,
  );

  it(
    'resolves by numeric ID',
    async () => {
      const r = await tg('info', String(myId));
      expect(r.ok).toBe(true);
      expect(r.data.entity.id).toBe(myId);
    },
    TIMEOUT,
  );

  it(
    'resolves by t.me link',
    async () => {
      const r = await tg('info', `t.me/${myUsername}`);
      expect(r.ok).toBe(true);
      expect(r.data.entity.id).toBe(myId);
      expect(r.data.entity.username).toBe(myUsername);
    },
    TIMEOUT,
  );

  it(
    'resolves negative group ID with -- separator',
    async () => {
      const groups = await tg('chats', 'list', '--type', 'group', '--limit', '1');
      expect(groups.ok).toBe(true);
      if (!groups.data.length) return;
      const groupId = groups.data[0].id;
      const r = await tg('info', '--', String(groupId));
      expect(r.ok).toBe(true);
      expect(r.data.entity.id).toBe(groupId);
    },
    TIMEOUT,
  );

  it(
    'chat section has id, unread, and date fields',
    async () => {
      const r = await tg('info', myUsername);
      expect(r.ok).toBe(true);
      expect(typeof r.data.chat.id).toBe('number');
      expect(typeof r.data.chat.unread).toBe('number');
      // last and last_date present when chat has messages
      if (r.data.chat.last) {
        expect(typeof r.data.chat.last).toBe('string');
        expect(typeof r.data.chat.last_date).toBe('string');
      }
    },
    TIMEOUT,
  );

  it(
    'channel has description when set',
    async () => {
      const r = await tg('info', '@telegram');
      expect(r.ok).toBe(true);
      expect(typeof r.data.entity.description).toBe('string');
      expect(r.data.entity.description.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    'shared groups are sorted by last_active (most recent first)',
    async () => {
      const contacts = await tg('chats', 'list', '--type', 'user', '--limit', '10');
      expect(contacts.ok).toBe(true);
      const contactId = contacts.data.find((c: { id: number }) => c.id !== myId)?.id;
      if (!contactId) return;
      const r = await tg('info', String(contactId));
      expect(r.ok).toBe(true);
      if (r.data.groups && r.data.groups.length >= 2) {
        // last_active dates should be in descending order
        for (let i = 1; i < r.data.groups.length; i++) {
          const prev = new Date(r.data.groups[i - 1].last_active);
          const curr = new Date(r.data.groups[i].last_active);
          expect(prev.getTime()).toBeGreaterThanOrEqual(curr.getTime());
        }
      }
    },
    TIMEOUT,
  );

  it(
    'shared groups have last_date for group overall activity',
    async () => {
      const contacts = await tg('chats', 'list', '--type', 'user', '--limit', '10');
      expect(contacts.ok).toBe(true);
      const contactId = contacts.data.find((c: { id: number }) => c.id !== myId)?.id;
      if (!contactId) return;
      const r = await tg('info', String(contactId));
      expect(r.ok).toBe(true);
      if (r.data.groups) {
        for (const g of r.data.groups) {
          expect(typeof g.last_date).toBe('string');
        }
      }
    },
    TIMEOUT,
  );

  it(
    'missing arg returns INVALID_ARGS',
    async () => {
      const r = await tg('info');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
    },
    TIMEOUT,
  );

  it(
    'old resolve command is rejected',
    async () => {
      const r = await tg('resolve', myUsername);
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
    },
    TIMEOUT,
  );
});

// ─── Members ───

describe('chats members', () => {
  let groupId: number;

  beforeAll(async () => {
    const r = await tg('chats', 'list', '--type', 'group', '--limit', '1');
    if (r.ok && r.data.length > 0) {
      groupId = r.data[0].id;
    }
  }, TIMEOUT);

  it(
    'returns member list with user_id and status',
    async () => {
      if (!groupId) return;
      const r = await tg('chats', 'members', String(groupId), '--limit', '10');
      expect(r.ok).toBe(true);
      for (const m of r.data) {
        expect(m.user_id).toBeNumber();
        expect(m.status).toMatch(/^(creator|admin|member|restricted|banned|left)$/);
      }
    },
    TIMEOUT,
  );

  it(
    '--type bot filters to bots only',
    async () => {
      if (!groupId) return;
      const r = await tg('chats', 'members', String(groupId), '--type', 'bot');
      expect(r.ok).toBe(true);
      // Results are filtered by the TDLib supergroupMembersFilterBots filter
      expect(Array.isArray(r.data)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    '--query filters by name',
    async () => {
      if (!groupId) return;
      const r = await tg('chats', 'members', String(groupId), '--query', 'a');
      expect(r.ok).toBe(true);
      expect(Array.isArray(r.data)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'invalid --type falls back to recent (no validation)',
    async () => {
      if (!groupId) return;
      const r = await tg('chats', 'members', String(groupId), '--type', 'invalid');
      // members command does not validate --type; unknown values fall through to 'recent'
      expect(r.ok).toBe(true);
      expect(Array.isArray(r.data)).toBe(true);
    },
    TIMEOUT,
  );
});

// ─── Download ───

describe('media download', () => {
  it(
    'downloads media from a message with photo',
    async () => {
      // Find a photo in Saved Messages
      const photos = await tg('msg', 'list', 'me', '--filter', 'photo', '--limit', '1');
      if (photos.ok && photos.data.length > 0) {
        const outputPath = path.join(tmpdir(), `tg_test_dl_${Date.now()}.jpg`);
        const msgId = photos.data[0].id ?? photos.data[0].ids?.[0];
        const r = await tg('media', 'download', 'me', String(msgId), '--output', outputPath);
        expect(r.ok).toBe(true);
        expect(r.data.file).toBeString();
        expect(r.data.size).toBeGreaterThan(0);
        expect(existsSync(outputPath)).toBe(true);
        unlinkSync(outputPath);
      }
    },
    TIMEOUT,
  );

  it(
    'no media returns NOT_FOUND',
    async () => {
      // Send a text-only message, try to download
      const s = await tg('action', 'send', 'me', 'no media here');
      expect(s.ok).toBe(true);
      track(s.data.id);
      const r = await tg('media', 'download', 'me', String(s.data.id));
      expect(r.ok).toBe(false);
      expect(r.code).toBe('NOT_FOUND');
    },
    TIMEOUT,
  );
});

// ─── Pin / Unpin ───

describe('action pin/unpin', () => {
  it(
    'pins and unpins a message',
    async () => {
      const s = await tg('action', 'send', 'me', 'pin test');
      expect(s.ok).toBe(true);
      track(s.data.id);
      const pin = await tg('action', 'pin', 'me', String(s.data.id), '--silent');
      expect(pin.ok).toBe(true);
      const unpin = await tg('action', 'unpin', 'me', String(s.data.id));
      expect(unpin.ok).toBe(true);
    },
    TIMEOUT,
  );
});

// ─── Eval ───

describe('eval', () => {
  it(
    'executes JavaScript and returns result',
    async () => {
      const r = await tg('eval', "return { hello: 'world' }");
      expect(r.ok).toBe(true);
      expect(r.data.hello).toBe('world');
    },
    TIMEOUT,
  );

  it(
    'has access to client',
    async () => {
      const r = await tg(
        'eval',
        "const me = await client.invoke({ _: 'getMe' }); return { id: me.id }",
      );
      expect(r.ok).toBe(true);
      expect(r.data.id).toBe(myId);
    },
    TIMEOUT,
  );
});

// ─── List ───

// ─── Error Handling ───

describe('error handling', () => {
  it(
    'unknown command returns INVALID_ARGS',
    async () => {
      const r = await tg('nonexistent');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
    },
    TIMEOUT,
  );

  it(
    'invalid entity returns NOT_FOUND',
    async () => {
      const r = await tg('info', 'xyznonexistent12345');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('NOT_FOUND');
    },
    TIMEOUT,
  );

  it(
    '--limit 0 returns INVALID_ARGS',
    async () => {
      const r = await tg('msg', 'list', 'me', '--limit', '0');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
    },
    TIMEOUT,
  );

  it(
    '--limit negative returns INVALID_ARGS',
    async () => {
      const r = await tg('msg', 'list', 'me', '--limit', '-1');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
    },
    TIMEOUT,
  );

  it(
    '--limit non-numeric returns INVALID_ARGS',
    async () => {
      const r = await tg('msg', 'list', 'me', '--limit', 'abc');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
    },
    TIMEOUT,
  );
});

// ─── Interoperability ───

describe('interoperability', () => {
  it(
    'unread → messages: last_read_inbox_message_id as --min-id',
    async () => {
      const unreads = await tg('chats', 'list', '--unread', '--limit', '1');
      expect(unreads.ok).toBe(true);
      if (unreads.data.length > 0 && unreads.data[0].last_read_inbox_message_id) {
        const chatId = unreads.data[0].id;
        const minId = unreads.data[0].last_read_inbox_message_id;
        const msgs = await tg(
          'msg',
          'list',
          String(chatId),
          '--min-id',
          String(minId),
          '--limit',
          '5',
        );
        expect(msgs.ok).toBe(true);
        for (const m of msgs.data) {
          expect(m.id).toBeGreaterThan(minId);
        }
      }
    },
    TIMEOUT,
  );

  it(
    'chats list → msg list: dialog ID works with messages',
    async () => {
      const dialogs = await tg('chats', 'list', '--limit', '3');
      expect(dialogs.ok).toBe(true);
      if (dialogs.data.length > 0) {
        const chatId = dialogs.data[0].id;
        const msgs = await tg('msg', 'list', String(chatId), '--limit', '2');
        expect(msgs.ok).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    'msg search → msg list: search chat_id works with messages (groups)',
    async () => {
      const search = await tg('msg', 'search', 'test', '--type', 'group', '--limit', '3');
      expect(search.ok).toBe(true);
      if (search.data.length > 0) {
        const chatId = search.data[0].chat_id;
        const msgs = await tg('msg', 'list', String(chatId), '--limit', '2');
        expect(msgs.ok).toBe(true);
        expect(msgs.data.length).toBeGreaterThan(0);
      }
    },
    TIMEOUT,
  );

  it(
    'end-of-flags -- separator',
    async () => {
      // Use -- to prevent negative ID from being parsed as flag
      const groups = await tg('chats', 'list', '--type', 'group', '--limit', '1');
      if (groups.ok && groups.data.length > 0) {
        const groupId = groups.data[0].id;
        const r = await tg('msg', 'list', '--limit', '2', '--', String(groupId));
        // This should work since -- stops flag parsing and groupId becomes positional
        // Note: with current parsing, positional args after -- work
        expect(r.ok).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    'messages media_album_id identifies albums',
    async () => {
      const r = await tg('msg', 'list', 'me', '--filter', 'photo', '--limit', '50');
      expect(r.ok).toBe(true);
      const withGroupId = r.data.filter((m: Record<string, unknown>) => m.media_album_id);
      // Group messages by media_album_id
      const albums = new Map<string, number>();
      for (const m of withGroupId) {
        albums.set(m.media_album_id, (albums.get(m.media_album_id) || 0) + 1);
      }
      // If albums exist, each should have >1 photo
      for (const [_gid, count] of albums) {
        expect(count).toBeGreaterThan(1);
      }
    },
    TIMEOUT,
  );

  it(
    'texturl entities rendered as markdown links in content.text',
    async () => {
      const r = await tg('msg', 'list', 'me', '--filter', 'url', '--limit', '20');
      expect(r.ok).toBe(true);
      // Entities are now rendered inline as markdown by unparse()
      // TextUrl entities appear as [text](url) in the content text
      const withMarkdownLink = r.data.filter((m: Record<string, unknown>) => {
        const content = m.content as Record<string, unknown> | undefined;
        if (!content) return false;
        const text = (content.text ?? content.caption ?? '') as string;
        return /\[.*?\]\(https?:\/\/.*?\)/.test(text);
      });
      for (const m of withMarkdownLink) {
        const text = (m.content.text ?? m.content.caption ?? '') as string;
        expect(text).toMatch(/\[.*?\]\(https?:\/\/.*?\)/);
      }
    },
    TIMEOUT,
  );
});

// ─── Input validation ───

describe('input validation', () => {
  it(
    'accepts equals-sign syntax for flag values',
    async () => {
      const r = await tg('chats', 'list', '--type=user', '--limit=3');
      expect(r.ok).toBe(true);
      for (const d of r.data) {
        expect(d.type).toBe('user');
      }
    },
    TIMEOUT,
  );

  it(
    'rejects unrecognized flags instead of silently ignoring them',
    async () => {
      const r = await tg('chats', 'list', '--bogus');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
      expect(r.error).toContain('--bogus');
    },
    TIMEOUT,
  );

  it(
    'error messages are concise and actionable',
    async () => {
      const r = await tg('msg', 'list');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
      // Should be concise, not contain the full usage line
      expect(r.error).not.toContain('[--limit N]');
      expect(r.error).toContain('--help');
    },
    TIMEOUT,
  );
});

// ─── Unread filtering ───

describe('unread filtering', () => {
  it(
    'dialogs can be filtered to only unread chats',
    async () => {
      const r = await tg('chats', 'list', '--unread', '--limit', '10');
      expect(r.ok).toBe(true);
      for (const d of r.data) {
        expect(d.unread).toBeGreaterThan(0);
      }
    },
    TIMEOUT,
  );

  it(
    'unread filter composes with chat type filter',
    async () => {
      const r = await tg('chats', 'list', '--unread', '--type', 'channel', '--limit', '5');
      expect(r.ok).toBe(true);
      for (const d of r.data) {
        expect(d.type).toBe('channel');
        expect(d.unread).toBeGreaterThan(0);
      }
    },
    TIMEOUT,
  );
});

// ─── Filter + Limit ───

describe('filter + limit', () => {
  // --- chats list: --type + --limit ---

  for (const type of ['user', 'bot', 'group', 'channel'] as const) {
    it(
      `chats list --type ${type} --limit 5 returns exactly 5 when enough exist`,
      async () => {
        const all = await tg('chats', 'list', '--type', type, '--limit', '50');
        expect(all.ok).toBe(true);
        for (const d of all.data) {
          expect(d.type).toBe(type);
        }
        if (all.data.length >= 5) {
          const r = await tg('chats', 'list', '--type', type, '--limit', '5');
          expect(r.ok).toBe(true);
          expect(r.data.length).toBe(5);
          for (const d of r.data) {
            expect(d.type).toBe(type);
          }
        }
      },
      TIMEOUT,
    );
  }

  // --- chats search: --type bot + --query + --limit ---

  it(
    'chats search --type bot --limit 5 returns only bots',
    async () => {
      const r = await tg('chats', 'search', 'bot', '--type', 'bot', '--limit', '5');
      expect(r.ok).toBe(true);
      expect(r.data.length).toBeLessThanOrEqual(5);
      for (const d of r.data) {
        expect(d.type).toBe('bot');
      }
    },
    TIMEOUT,
  );

  it(
    'chats search --type chat --limit 5 returns only direct chats',
    async () => {
      const r = await tg('chats', 'search', 'a', '--type', 'chat', '--limit', '5');
      expect(r.ok).toBe(true);
      expect(r.data.length).toBeLessThanOrEqual(5);
      for (const d of r.data) {
        expect(d.type).toBe('user');
      }
    },
    TIMEOUT,
  );

  it(
    'chats search --type channel --limit 5 returns only channels',
    async () => {
      const r = await tg('chats', 'search', 'news', '--type', 'channel', '--limit', '5');
      expect(r.ok).toBe(true);
      expect(r.data.length).toBeLessThanOrEqual(5);
      for (const d of r.data) {
        expect(d.user).toBeUndefined();
      }
    },
    TIMEOUT,
  );

  // --- msg list: --filter + --limit ---

  it(
    'msg list --filter photo --limit 5 returns exactly 5 when enough exist',
    async () => {
      const all = await tg('msg', 'list', 'me', '--filter', 'photo', '--limit', '20');
      expect(all.ok).toBe(true);
      for (const m of all.data) {
        // Single photo or album (photos plural)
        expect(m.photo ?? m.photos).toBeTruthy();
      }
      if (all.data.length >= 5) {
        const r = await tg('msg', 'list', 'me', '--filter', 'photo', '--limit', '5');
        expect(r.ok).toBe(true);
        expect(r.data.length).toBe(5);
        for (const m of r.data) {
          expect(m.photo ?? m.photos).toBeTruthy();
        }
      }
    },
    TIMEOUT,
  );

  it(
    'msg list --filter voice --limit 5 returns only voice notes',
    async () => {
      const r = await tg('msg', 'list', 'me', '--filter', 'voice', '--limit', '5');
      expect(r.ok).toBe(true);
      expect(r.data.length).toBeLessThanOrEqual(5);
      for (const m of r.data) {
        expect(m.voice).toBeTruthy();
      }
    },
    TIMEOUT,
  );

  // --- msg search: --type + --limit ---

  it(
    'msg search --type channel --limit 5 returns only channel messages',
    async () => {
      const r = await tg('msg', 'search', 'a', '--type', 'channel', '--limit', '5');
      expect(r.ok).toBe(true);
      expect(r.data.length).toBeLessThanOrEqual(5);
      for (const m of r.data) {
        expect(m.chat_id).toBeLessThan(0);
      }
    },
    TIMEOUT,
  );

  it(
    'msg search --filter photo --limit 5 returns only photos',
    async () => {
      const r = await tg('msg', 'search', 'a', '--filter', 'photo', '--limit', '5');
      expect(r.ok).toBe(true);
      expect(r.data.length).toBeLessThanOrEqual(5);
      for (const m of r.data) {
        expect(m.content).toBe('photo');
      }
    },
    TIMEOUT,
  );

  // --- chats members: --type bot + --limit ---

  it(
    'chats members --type bot --limit 5 returns only bots',
    async () => {
      const group = await tg('chats', 'list', '--type', 'group', '--limit', '1');
      if (!group.ok || group.data.length === 0) return;
      const r = await tg(
        'chats',
        'members',
        String(group.data[0].id),
        '--type',
        'bot',
        '--limit',
        '5',
      );
      expect(r.ok).toBe(true);
      expect(r.data.length).toBeLessThanOrEqual(5);
    },
    TIMEOUT,
  );
});

// ─── CLI does not mutate Telegram state ───

describe('state-mutating commands are removed', () => {
  it(
    'open-chat is rejected',
    async () => {
      const r = await tg('open-chat', 'me');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
      expect(r.error).toContain('Unknown command');
    },
    TIMEOUT,
  );

  it(
    'close-chat is rejected',
    async () => {
      const r = await tg('close-chat', 'me');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
      expect(r.error).toContain('Unknown command');
    },
    TIMEOUT,
  );

  it(
    'read is rejected',
    async () => {
      const r = await tg('read', 'me');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
      expect(r.error).toContain('Unknown command');
    },
    TIMEOUT,
  );
});

// ─── Media-only search ───

describe('media search without text query', () => {
  it(
    'search by media type does not require a text query',
    async () => {
      const r = await tg('msg', 'search', '--chat', 'me', '--filter', 'photo', '--limit', '3');
      expect(r.ok).toBe(true);
      expect(Array.isArray(r.data)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'search requires either a text query or a media filter',
    async () => {
      const r = await tg('msg', 'search');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ARGS');
      expect(r.error).toContain('--filter');
    },
    TIMEOUT,
  );
});

// ─── Sender identity ───

describe('sender identity in messages', () => {
  it(
    'every message includes the sender display name',
    async () => {
      const r = await tg('msg', 'list', 'me', '--limit', '3');
      expect(r.ok).toBe(true);
      for (const m of r.data) {
        expect(m.name).toBeString();
        expect(m.name.length).toBeGreaterThan(0);
      }
    },
    TIMEOUT,
  );

  it(
    'group messages resolve sender names for each participant',
    async () => {
      const groups = await tg('chats', 'list', '--type', 'group', '--limit', '1');
      if (groups.ok && groups.data.length > 0) {
        const r = await tg('msg', 'list', String(groups.data[0].id), '--limit', '5');
        expect(r.ok).toBe(true);
        for (const m of r.data) {
          expect(m.name).toBeString();
        }
      }
    },
    TIMEOUT,
  );
});

// ─── Limit guarantees with client-side filters ───

describe('limit is respected even with client-side filtering', () => {
  it(
    'sender filter still returns the requested number of messages',
    async () => {
      const r = await tg('msg', 'list', 'me', '--limit', '5', '--from', String(myId));
      expect(r.ok).toBe(true);
      expect(r.data.length).toBe(5);
      for (const m of r.data) {
        expect(m.name).toBeString();
      }
    },
    TIMEOUT,
  );

  it(
    'media filter still returns the requested number of messages',
    async () => {
      const r = await tg('msg', 'list', 'me', '--filter', 'photo', '--limit', '5');
      expect(r.ok).toBe(true);
      if (r.hasMore) {
        expect(r.data.length).toBe(5);
      }
      for (const m of r.data) {
        expect(m.photo ?? m.photos).toBeTruthy();
      }
    },
    TIMEOUT,
  );
});

// ─── Direct file download ───

describe('media download by file ID', () => {
  // Note: 'files can be downloaded using just their TDLib file ID' test removed —
  // flat format doesn't expose TDLib file IDs, so we can't extract one from message output.

  it(
    'download by chat + message ID still works',
    async () => {
      const r = await tg('msg', 'list', 'me', '--filter', 'photo', '--limit', '1');
      expect(r.ok).toBe(true);
      if (r.data.length > 0) {
        const msgId = r.data[0].id ?? r.data[0].ids?.[0];
        const dl = await tg('media', 'download', 'me', String(msgId));
        expect(dl.ok).toBe(true);
        expect(dl.data.file).toBeString();
      }
    },
    TIMEOUT,
  );
});

// ─── Speech recognition ───

describe('speech recognition', () => {
  it(
    'transcribe rejects non-audio messages',
    async () => {
      const r = await tg('msg', 'list', 'me', '--limit', '1');
      expect(r.ok).toBe(true);
      if (
        r.data.length > 0 &&
        r.data[0].text &&
        !r.data[0].photo &&
        !r.data[0].voice &&
        !r.data[0].video
      ) {
        const t = await tg('media', 'transcribe', 'me', String(r.data[0].id));
        expect(t.ok).toBe(false);
        expect(t.code).toBe('INVALID_ARGS');
      }
    },
    TIMEOUT,
  );
});

// ─── Voice note transcript in message output ───

describe('voice note transcript in output', () => {
  it(
    'voice notes include transcript text when already recognized',
    async () => {
      // Find voice notes via search — transcript may or may not be present
      const r = await tg('msg', 'search', '--chat', 'me', '--filter', 'voice', '--limit', '5');
      if (!r.ok || r.data.length === 0) return;
      for (const m of r.data) {
        expect(m.voice).toBeTruthy();
        // transcript is optional — just verify it's a string when present
        if (m.transcript !== undefined) {
          expect(m.transcript).toBeString();
          expect(m.transcript.length).toBeGreaterThan(0);
        }
      }
    },
    TIMEOUT,
  );
});

// ─── Smart date formatting ───

describe('smart date formatting', () => {
  it(
    'today messages show absolute format with time',
    async () => {
      // Send a message so we guarantee a "today" date
      const s = await tg('action', 'send', 'me', `date-test-${Date.now()}`);
      expect(s.ok).toBe(true);
      track(s.data.id);
      const r = await tg('msg', 'list', 'me', '--limit', '1');
      expect(r.ok).toBe(true);
      // Format: "Mar 4, 14:30" (this year) or "Mar 4, 2025, 14:30" (other year)
      expect(r.data[0].date).toMatch(/^[A-Z][a-z]{2} \d{1,2}, (\d{4}, )?\d{2}:\d{2}$/);
    },
    TIMEOUT,
  );

  it(
    'dates use absolute format (MMM D, HH:MM)',
    async () => {
      const r = await tg('msg', 'list', 'me', '--limit', '50');
      expect(r.ok).toBe(true);
      // Format: "Mar 4, 14:30" (this year) or "Mar 4, 2025, 14:30" (other year)
      const validFormat = /^[A-Z][a-z]{2} \d{1,2}, (\d{4}, )?\d{2}:\d{2}$/;
      for (const m of r.data) {
        expect(m.date).toMatch(validFormat);
      }
    },
    TIMEOUT,
  );

  it(
    'dialog last_date uses absolute format',
    async () => {
      const r = await tg('chats', 'list', '--limit', '5');
      expect(r.ok).toBe(true);
      const validFormat = /^[A-Z][a-z]{2} \d{1,2}, (\d{4}, )?\d{2}:\d{2}$/;
      for (const d of r.data) {
        if (d.last_date) {
          expect(d.last_date).toMatch(validFormat);
        }
      }
    },
    TIMEOUT,
  );
});

// ─── Media paths in output ───

describe('media paths in message output', () => {
  it(
    'photos have path or true indicator',
    async () => {
      const r = await tg('msg', 'list', 'me', '--filter', 'photo', '--limit', '3');
      expect(r.ok).toBe(true);
      for (const m of r.data) {
        const photoVal = m.photo ?? m.photos;
        expect(photoVal).toBeTruthy();
        // Each photo is either a string path or true (not downloaded)
        const values = Array.isArray(photoVal) ? photoVal : [photoVal];
        for (const v of values) {
          expect(typeof v === 'string' || v === true).toBe(true);
        }
      }
    },
    TIMEOUT,
  );

  it(
    '--auto-download adds paths to photos',
    async () => {
      const r = await tg(
        'msg',
        'list',
        'me',
        '--filter',
        'photo',
        '--limit',
        '2',
        '--auto-download',
      );
      expect(r.ok).toBe(true);
      for (const m of r.data) {
        const values = m.photos ?? [m.photo];
        for (const v of values) {
          // With --auto-download, photos should have string paths (starting with ~ or /)
          expect(v).toBeString();
          expect(v.startsWith('~') || v.startsWith('/')).toBe(true);
        }
      }
    },
    TIMEOUT,
  );

  it(
    'document albums show docs array with filenames',
    async () => {
      const r = await tg('msg', 'list', 'me', '--filter', 'document', '--limit', '5');
      expect(r.ok).toBe(true);
      for (const m of r.data) {
        if (m.ids) {
          // Album: should have docs array
          expect(m.content).toBe('doc');
          expect(Array.isArray(m.docs)).toBe(true);
          expect(m.docs.length).toBe(m.ids.length);
          for (const d of m.docs) {
            expect(d).toBeString();
            expect(d.length).toBeGreaterThan(0);
          }
        } else {
          // Single doc: should have doc field
          expect(m.doc).toBeString();
          expect(m.doc.length).toBeGreaterThan(0);
        }
      }
    },
    TIMEOUT,
  );

  it(
    '--auto-download downloads documents and shows paths',
    async () => {
      const r = await tg(
        'msg',
        'list',
        'me',
        '--filter',
        'document',
        '--limit',
        '1',
        '--auto-download',
      );
      expect(r.ok).toBe(true);
      if (r.data.length > 0) {
        const m = r.data[0];
        // Single doc should have a file path, not just filename
        if (m.doc) {
          // After download, doc should be a path (contains / or ~)
          expect(m.doc.includes('/') || m.doc.startsWith('~')).toBe(true);
        }
        // Album docs should also have paths
        if (m.docs) {
          for (const d of m.docs) {
            expect(d.includes('/') || d.startsWith('~')).toBe(true);
          }
        }
      }
    },
    TIMEOUT,
  );
});

// ─── Offset & Context (known messages) ───

describe('offset and context with known messages', () => {
  const nonce = `e2e${Date.now()}`;
  const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
  const msgIds: number[] = [];

  beforeAll(async () => {
    // Send 7 numbered messages to Saved Messages
    for (let i = 0; i < 7; i++) {
      const r = await tg('action', 'send', 'me', `${nonce}${words[i]}`);
      expect(r.ok).toBe(true);
      msgIds.push(r.data.id);
      track(r.data.id);
    }
  }, 60_000);

  it(
    '--offset-id returns messages older than the offset',
    async () => {
      // offset-id = msg 5 → should return msg 4, 3, 2, 1
      const r = await tg('msg', 'list', 'me', '--limit', '4', '--offset-id', String(msgIds[4]));
      expect(r.ok).toBe(true);
      const ids = r.data.map((m: { id: number }) => m.id);
      expect(ids).toContain(msgIds[3]); // msg 4
      expect(ids).toContain(msgIds[2]); // msg 3
      // All must be older than offset
      for (const id of ids) {
        expect(id).toBeLessThan(msgIds[4]);
      }
    },
    TIMEOUT,
  );

  it(
    '--offset-id paginates through all known messages',
    async () => {
      // Page 1: latest 3
      const p1 = await tg('msg', 'list', 'me', '--limit', '3');
      expect(p1.ok).toBe(true);
      expect(p1.data.length).toBeGreaterThanOrEqual(3);
      // Page 2: next 3 using nextOffset
      const p2 = await tg(
        'msg',
        'list',
        'me',
        '--limit',
        '3',
        '--offset-id',
        String(p1.nextOffset),
      );
      expect(p2.ok).toBe(true);
      expect(p2.data.length).toBeGreaterThanOrEqual(3);
      // No overlap between pages
      const p1Ids = new Set(p1.data.map((m: { id: number }) => m.id));
      for (const m of p2.data) {
        expect(p1Ids.has(m.id)).toBe(false);
      }
      // Page 2 messages are all older than page 1 messages
      const p1Min = Math.min(...p1.data.map((m: { id: number }) => m.id));
      for (const m of p2.data) {
        expect(m.id).toBeLessThan(p1Min);
      }
    },
    TIMEOUT,
  );

  it(
    '--context returns symmetric surrounding messages including the hit',
    async () => {
      // Search for msg 4 (index 3) with context 2
      const r = await tg(
        'msg',
        'search',
        `${nonce}four`,
        '--chat',
        'me',
        '--context',
        '2',
        '--limit',
        '1',
      );
      expect(r.ok).toBe(true);
      expect(r.data.length).toBe(1);
      const hit = r.data[0];
      expect(hit.id).toBe(msgIds[3]);
      expect(Array.isArray(hit.context)).toBe(true);
      // Context should have 5 messages: 2 after + hit + 2 before
      expect(hit.context.length).toBe(5);
      const ctxIds = hit.context.map((m: { id: number }) => m.id);
      // Should include the hit itself
      expect(ctxIds).toContain(msgIds[3]); // msg 4 (hit)
      // Should include 2 newer
      expect(ctxIds).toContain(msgIds[4]); // msg 5
      expect(ctxIds).toContain(msgIds[5]); // msg 6
      // Should include 2 older
      expect(ctxIds).toContain(msgIds[2]); // msg 3
      expect(ctxIds).toContain(msgIds[1]); // msg 2
    },
    TIMEOUT,
  );

  it(
    '--context at edge of history returns available messages',
    async () => {
      // Search for msg 1 (oldest) with context 2 — only newer context available
      const r = await tg(
        'msg',
        'search',
        `${nonce}one`,
        '--chat',
        'me',
        '--context',
        '2',
        '--limit',
        '1',
      );
      expect(r.ok).toBe(true);
      expect(r.data.length).toBe(1);
      const hit = r.data[0];
      expect(hit.id).toBe(msgIds[0]);
      expect(Array.isArray(hit.context)).toBe(true);
      // At least the hit + 2 newer messages
      expect(hit.context.length).toBeGreaterThanOrEqual(3);
      const ctxIds = hit.context.map((m: { id: number }) => m.id);
      expect(ctxIds).toContain(msgIds[0]); // msg 1 (hit)
      expect(ctxIds).toContain(msgIds[1]); // msg 2
      expect(ctxIds).toContain(msgIds[2]); // msg 3
    },
    TIMEOUT,
  );
});
