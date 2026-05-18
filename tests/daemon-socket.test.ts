import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'tg-agent-sock-'));
  vi.resetModules();
});

afterEach(() => {
  delete process.env.TELEGRAM_AGENT_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('daemonSocketPath', () => {
  it('honors TELEGRAM_AGENT_HOME env override', async () => {
    process.env.TELEGRAM_AGENT_HOME = tmpHome;
    const { daemonSocketPath } = await import('../src/daemon/socket.js');
    expect(daemonSocketPath()).toBe(join(tmpHome, 'daemon.sock'));
  });

  it('defaults to ~/.telegram-agent/daemon.sock', async () => {
    delete process.env.TELEGRAM_AGENT_HOME;
    const { daemonSocketPath } = await import('../src/daemon/socket.js');
    expect(daemonSocketPath()).toBe(join(homedir(), '.telegram-agent', 'daemon.sock'));
  });
});
