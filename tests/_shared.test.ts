import { describe, it, expect } from 'vitest';
import { flagStr, flagNum, flagBool, need } from '../src/commands/_shared.js';

describe('flag helpers', () => {
  it('flagStr returns string flag, undefined for boolean', () => {
    expect(flagStr({ name: 'alice' }, 'name')).toBe('alice');
    expect(flagStr({ verbose: true }, 'verbose')).toBeUndefined();
    expect(flagStr({}, 'missing')).toBeUndefined();
  });

  it('flagNum parses numeric strings', () => {
    expect(flagNum({ limit: '50' }, 'limit')).toBe(50);
    expect(flagNum({ limit: '-1' }, 'limit')).toBe(-1);
    expect(flagNum({}, 'limit')).toBeUndefined();
  });

  it('flagBool returns true when present without value', () => {
    expect(flagBool({ unread: true }, 'unread')).toBe(true);
    expect(flagBool({}, 'unread')).toBeUndefined();
  });

  it('flagBool parses string "true" / "false"', () => {
    expect(flagBool({ pinned: 'true' }, 'pinned')).toBe(true);
    expect(flagBool({ pinned: 'false' }, 'pinned')).toBe(false);
  });
});

describe('need', () => {
  it('returns positional arg when present', () => {
    expect(need(['@chan', '5'], 0, 'chat')).toBe('@chan');
    expect(need(['@chan', '5'], 1, 'msgId')).toBe('5');
  });

  it('throws via fail when arg missing', () => {
    // need calls fail() which calls process.exit(1) — we shim by stubbing.
    const origExit = process.exit;
    const origStderr = process.stderr.write;
    let exitCode: number | string | null | undefined;
    let stderrOut = '';
    process.exit = ((code: any) => {
      exitCode = code;
      throw new Error('__exit__');
    }) as any;
    process.stderr.write = ((chunk: any) => {
      stderrOut += String(chunk);
      return true;
    }) as any;
    try {
      expect(() => need([], 0, 'chat')).toThrow('__exit__');
      expect(exitCode).toBe(1);
      expect(stderrOut).toContain('chat');
    } finally {
      process.exit = origExit;
      process.stderr.write = origStderr;
    }
  });
});
