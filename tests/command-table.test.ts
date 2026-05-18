import { describe, it, expect } from 'vitest';
import { commandTable } from '../src/commands/index.js';

function get(table: any, path: string[]): any {
  let cur = table;
  for (const p of path) {
    if (typeof cur !== 'object' || cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

describe('commandTable', () => {
  it('exposes the noun-verb leaves', () => {
    expect(typeof get(commandTable, ['chats', 'list'])).toBe('function');
    expect(typeof get(commandTable, ['chats', 'search'])).toBe('function');
    expect(typeof get(commandTable, ['chats', 'members'])).toBe('function');
    expect(typeof get(commandTable, ['msg', 'list'])).toBe('function');
    expect(typeof get(commandTable, ['msg', 'get'])).toBe('function');
    expect(typeof get(commandTable, ['msg', 'search'])).toBe('function');
    expect(typeof get(commandTable, ['action', 'send'])).toBe('function');
    expect(typeof get(commandTable, ['action', 'react'])).toBe('function');
    expect(typeof get(commandTable, ['action', 'click'])).toBe('function');
    expect(typeof get(commandTable, ['media', 'send'])).toBe('function');
    expect(typeof get(commandTable, ['media', 'download'])).toBe('function');
    expect(typeof get(commandTable, ['media', 'transcribe'])).toBe('function');
    expect(typeof get(commandTable, ['media', 'caption'])).toBe('function');
    expect(typeof get(commandTable, ['saved', 'tags'])).toBe('function');
    expect(typeof get(commandTable, ['session', 'export'])).toBe('function');
    expect(typeof get(commandTable, ['session', 'import'])).toBe('function');
  });

  it('exposes single-shot leaves at the top level', () => {
    for (const name of ['login', 'logout', 'accounts', 'me', 'info', 'doctor', 'listen', 'invoke']) {
      expect(typeof get(commandTable, [name])).toBe('function');
    }
  });

  it('has no flat aliases for noun-verb leaves', () => {
    // Flat aliases (dialogs, messages, send, …) were dropped — only the
    // noun-verb form is supported. This test guards against accidental
    // re-introduction.
    for (const alias of [
      'dialogs',
      'search-dialogs',
      'participants',
      'resolve',
      'messages',
      'search',
      'search-global',
      'get',
      'send',
      'edit',
      'delete',
      'forward',
      'pin',
      'unpin',
      'react',
      'mark-read',
      'send-file',
      'download',
    ]) {
      expect(commandTable[alias]).toBeUndefined();
    }
  });
});
