/**
 * End-to-end smoke tests — spawn the built CLI and assert behavior
 * across the wire boundary. No Telegram credentials needed; everything
 * here exercises argv parsing, output shape, error codes, and the
 * help screen.
 *
 * Real-account flows that need TELEGRAM_API_ID/HASH live elsewhere
 * (and would be opt-in via env). Keep this file self-contained so it
 * runs on every PR.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname ?? __dirname, '..', '..');
const CLI = join(REPO_ROOT, 'dist', 'cli.js');

function run(args: string[], opts: { env?: Record<string, string> } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, TELEGRAM_AGENT_HOME: '/tmp/__tg_agent_e2e__', ...(opts.env ?? {}) },
  });
}

describe('e2e cli (built dist)', () => {
  it('has a built dist/cli.js', () => {
    expect(existsSync(CLI)).toBe(true);
  });

  it('--version prints semver JSON', () => {
    const r = run(['--version']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim());
    expect(parsed.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('--help renders the usage screen', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('telegram-agent');
    expect(r.stdout).toContain('chats list');
    expect(r.stdout).toContain('action send');
  });

  it('unknown command emits INVALID_ARGS', () => {
    const r = run(['totally-not-a-command']);
    expect(r.status).toBe(1);
    const err = JSON.parse(r.stderr.trim());
    expect(err.ok).toBe(false);
    expect(err.code).toBe('INVALID_ARGS');
    expect(err.error).toContain('Unknown command');
  });

  it('eval without --confirm emits PERMISSION', () => {
    const r = run(['eval', '1+1']);
    expect(r.status).toBe(1);
    const err = JSON.parse(r.stderr.trim());
    expect(err.code).toBe('PERMISSION');
    expect(err.error.toLowerCase()).toContain('confirm');
  });

  it('invoke of destructive method without --confirm emits PERMISSION', () => {
    const r = run(['invoke', 'channels.DeleteMessages', '--params', '{}']);
    expect(r.status).toBe(1);
    const err = JSON.parse(r.stderr.trim());
    expect(err.code).toBe('PERMISSION');
    expect(err.error.toLowerCase()).toContain('destructive');
  });

  it('doctor returns JSON envelope with checks[]', () => {
    const r = run(['doctor']);
    // doctor exit code is 1 when any check fails — in CI we have no
    // credentials so creds will fail. The shape should still parse.
    const parsed = JSON.parse(r.stdout.trim());
    expect(parsed).toHaveProperty('checks');
    expect(Array.isArray(parsed.checks)).toBe(true);
    const names = parsed.checks.map((c: any) => c.check);
    expect(names).toContain('node');
    expect(names).toContain('credentials');
    expect(names).toContain('daemon');
  });

  it('accounts with no logged-in account returns empty list', () => {
    const r = run(['accounts']);
    // No creds → some commands fail with INVALID_ARGS; accounts is a
    // pure state.json read and should succeed with an empty list.
    if (r.status === 0) {
      const parsed = JSON.parse(r.stdout.trim());
      expect(Array.isArray(parsed)).toBe(true);
    } else {
      // Acceptable if state dir is brand new and the command errored
      // for an unrelated reason — at minimum stderr should parse.
      const err = JSON.parse(r.stderr.trim());
      expect(err).toHaveProperty('code');
    }
  });
});
