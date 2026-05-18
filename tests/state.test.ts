import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let tmpHome: string;

beforeEach(() => {
  vi.resetModules();
  tmpHome = mkdtempSync(join(tmpdir(), 'tg-agent-state-'));
  process.env.TELEGRAM_AGENT_HOME = tmpHome;
});

afterEach(() => {
  delete process.env.TELEGRAM_AGENT_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('state.ts', () => {
  it('creates state.json on first load() with mode 0600', async () => {
    const state = await import('../src/state.js');
    state.loadState();
    const file = join(tmpHome, 'state.json');
    expect(existsSync(file)).toBe(true);
    const mode = statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('chmods base dir and sessions dir to 0700', async () => {
    const state = await import('../src/state.js');
    state.loadState();
    expect(statSync(tmpHome).mode & 0o777).toBe(0o700);
    expect(statSync(join(tmpHome, 'sessions')).mode & 0o777).toBe(0o700);
  });

  it('upsertAccount persists across cache clear', async () => {
    const state = await import('../src/state.js');
    state.upsertAccount({ id: '42', phone: '+100', created_at: Date.now() });

    // Re-import to force a fresh cache.
    vi.resetModules();
    const state2 = await import('../src/state.js');
    const a = state2.getAccount('42');
    expect(a?.phone).toBe('+100');
  });

  it('persists raw JSON shape', async () => {
    const state = await import('../src/state.js');
    state.upsertAccount({ id: '1', phone: '+1', created_at: 0 });
    const raw = JSON.parse(readFileSync(join(tmpHome, 'state.json'), 'utf-8'));
    expect(raw.version).toBe(1);
    expect(raw.accounts['1'].phone).toBe('+1');
  });
});
