import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSession } from '../src/session.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tg-agent-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('FileSession', () => {
  it('writes session fields with plain filenames (no URL-encoding leak)', async () => {
    const sess = new FileSession(dir);
    sess.setDC(2, 'example.com', 443);
    const files = readdirSync(dir);
    expect(files).toContain('dcId');
    expect(files).toContain('port');
    expect(files).toContain('serverAddress');
    // No URL-encoded keys from gram.js's bundled StoreSession bug.
    expect(files.some((f) => f.includes('%2F') || f.includes('%3A'))).toBe(false);
  });

  it('does not write into cwd when given an absolute path', async () => {
    const cwdBefore = process.cwd();
    const sess = new FileSession(dir);
    sess.setDC(2, 'example.com', 443);
    expect(process.cwd()).toBe(cwdBefore);
    // No stray Users/ tree under cwd.
    const cwdEntries = readdirSync(cwdBefore);
    expect(cwdEntries).not.toContain('Users');
  });

  it('chmods the session directory to 0700', () => {
    new FileSession(dir);
    const mode = statSync(dir).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('chmods session files to 0600 after write', () => {
    const sess = new FileSession(dir);
    sess.setDC(2, 'example.com', 443);
    for (const f of readdirSync(dir)) {
      const mode = statSync(join(dir, f)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('round-trips dcId / serverAddress / port through load()', async () => {
    const sess1 = new FileSession(dir);
    sess1.setDC(4, 'venus.web.telegram.org', 443);

    const sess2 = new FileSession(dir);
    await sess2.load();
    expect((sess2 as any)._dcId).toBe(4);
    expect((sess2 as any)._serverAddress).toBe('venus.web.telegram.org');
    expect((sess2 as any)._port).toBe(443);
  });
});
