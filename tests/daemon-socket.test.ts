import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';

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
