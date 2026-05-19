/**
 * Unit tests for `session export` / `session import`.
 *
 * These spawn the CLI as a subprocess with an isolated TG_APP_DIR so we never
 * touch the user's real `~/.telegram-agent/` directory.
 *
 * No real Telegram I/O — both commands are pure filesystem operations.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CLI_ENTRY = path.resolve(import.meta.dir, '../../src/index.ts');

function run(args: string[], env: Record<string, string>) {
  const r = spawnSync('bun', ['run', CLI_ENTRY, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf-8',
    timeout: 10_000,
  });
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse((r.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '');
  } catch {
    parsed = null;
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: parsed };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'tg-session-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('session export', () => {
  test('returns NOT_FOUND when tdlib_db does not exist', () => {
    const { json } = run(['session', 'export'], { TG_APP_DIR: tmpDir });
    expect(json?.ok).toBe(false);
    expect(json?.code).toBe('NOT_FOUND');
    expect(String(json?.error)).toMatch(/No session found/);
  });

  test('emits base64 tarball when tdlib_db exists', () => {
    const dbDir = path.join(tmpDir, 'tdlib_db');
    mkdirSync(dbDir, { recursive: true });
    writeFileSync(path.join(dbDir, 'td.binlog'), 'fake-binlog-content');

    const { json } = run(['session', 'export'], { TG_APP_DIR: tmpDir });
    expect(json?.ok).toBe(true);
    const data = json?.data as Record<string, unknown> | undefined;
    expect(data?.format).toBe('tdlib-session-tar.b64.v1');
    expect(typeof data?.blob).toBe('string');
    expect((data?.blob as string).length).toBeGreaterThan(0);
    expect(data?.bytes).toBeGreaterThan(0);
  });
});

describe('session import', () => {
  test('returns INVALID_ARGS when no blob source given', () => {
    const { json } = run(['session', 'import'], { TG_APP_DIR: tmpDir });
    expect(json?.ok).toBe(false);
    expect(json?.code).toBe('INVALID_ARGS');
  });

  test('returns INVALID_ARGS on empty blob', () => {
    const { json } = run(['session', 'import', '--string', ''], { TG_APP_DIR: tmpDir });
    expect(json?.ok).toBe(false);
    expect(json?.code).toBe('INVALID_ARGS');
  });

  test('returns PERMISSION when session already present and no --force', () => {
    const dbDir = path.join(tmpDir, 'tdlib_db');
    mkdirSync(dbDir, { recursive: true });
    writeFileSync(path.join(dbDir, 'td.binlog'), 'existing');

    // Need a real-looking base64 blob — any non-empty value triggers the precondition
    // check before any tar work.
    const { json } = run(['session', 'import', '--string', 'aGVsbG8='], { TG_APP_DIR: tmpDir });
    expect(json?.ok).toBe(false);
    expect(json?.code).toBe('PERMISSION');
    expect(String(json?.error)).toMatch(/already exists/);
  });

  test('round-trip export → import restores tdlib_db contents', () => {
    // Create + export.
    const srcDb = path.join(tmpDir, 'tdlib_db');
    mkdirSync(srcDb, { recursive: true });
    const payload = 'round-trip-payload-' + Math.random();
    writeFileSync(path.join(srcDb, 'td.binlog'), payload);
    const exported = run(['session', 'export'], { TG_APP_DIR: tmpDir });
    const blob = (exported.json?.data as { blob: string }).blob;
    expect(blob).toBeTruthy();

    // Wipe and import into a fresh dir.
    const importDir = mkdtempSync(path.join(tmpdir(), 'tg-session-import-'));
    try {
      const imported = run(['session', 'import', '--string', blob], { TG_APP_DIR: importDir });
      expect(imported.json?.ok).toBe(true);
      const restored = path.join(importDir, 'tdlib_db', 'td.binlog');
      expect(Bun.file(restored).size).toBeGreaterThan(0);
    } finally {
      rmSync(importDir, { recursive: true, force: true });
    }
  });
});
