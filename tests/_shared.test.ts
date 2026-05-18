import { describe, it, expect } from 'vitest';
import { flagStr, flagNum, flagBool, need, classifyError } from '../src/commands/_shared.js';

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

  it('throws via fail when arg missing, emits {code: INVALID_ARGS}', () => {
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
      const parsed = JSON.parse(stderrOut.trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain('chat');
      expect(parsed.code).toBe('INVALID_ARGS');
    } finally {
      process.exit = origExit;
      process.stderr.write = origStderr;
    }
  });
});

describe('classifyError', () => {
  it('matches FLOOD_WAIT', () => {
    expect(classifyError(new Error('FLOOD_WAIT_42'))).toBe('FLOOD_WAIT');
  });

  it('matches NOT_FOUND patterns', () => {
    expect(classifyError(new Error('PEER_ID_INVALID'))).toBe('NOT_FOUND');
    expect(classifyError(new Error('USERNAME_NOT_OCCUPIED'))).toBe('NOT_FOUND');
    expect(classifyError(new Error('MSG_ID_INVALID'))).toBe('NOT_FOUND');
    expect(classifyError(new Error('CHANNEL_INVALID'))).toBe('NOT_FOUND');
  });

  it('matches PREMIUM', () => {
    expect(classifyError(new Error('PREMIUM_ACCOUNT_REQUIRED'))).toBe('PREMIUM');
  });

  it('matches PERMISSION patterns', () => {
    expect(classifyError(new Error('CHAT_ADMIN_REQUIRED'))).toBe('PERMISSION');
    expect(classifyError(new Error('CHAT_WRITE_FORBIDDEN'))).toBe('PERMISSION');
    expect(classifyError(new Error('USER_PRIVACY_RESTRICTED'))).toBe('PERMISSION');
  });

  it('falls back to UNKNOWN', () => {
    expect(classifyError(new Error('some random gram.js failure'))).toBe('UNKNOWN');
    expect(classifyError('plain string')).toBe('UNKNOWN');
    expect(classifyError(undefined)).toBe('UNKNOWN');
  });
});
