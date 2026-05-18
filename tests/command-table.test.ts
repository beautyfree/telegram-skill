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
    expect(typeof get(commandTable, ['saved', 'tags'])).toBe('function');
    expect(typeof get(commandTable, ['session', 'export'])).toBe('function');
    expect(typeof get(commandTable, ['session', 'import'])).toBe('function');
  });

  it('exposes single-shot leaves at the top level', () => {
    for (const name of ['login', 'logout', 'accounts', 'me', 'info', 'doctor', 'listen', 'invoke']) {
      expect(typeof get(commandTable, [name])).toBe('function');
    }
  });

  it('preserves back-compat flat aliases', () => {
    expect(commandTable.dialogs).toBe(get(commandTable, ['chats', 'list']));
    expect(commandTable['search-dialogs']).toBe(get(commandTable, ['chats', 'search']));
    expect(commandTable.participants).toBe(get(commandTable, ['chats', 'members']));
    expect(commandTable.messages).toBe(get(commandTable, ['msg', 'list']));
    expect(commandTable.get).toBe(get(commandTable, ['msg', 'get']));
    expect(commandTable.send).toBe(get(commandTable, ['action', 'send']));
    expect(commandTable.delete).toBe(get(commandTable, ['action', 'delete']));
    expect(commandTable.forward).toBe(get(commandTable, ['action', 'forward']));
    expect(commandTable['mark-read']).toBe(get(commandTable, ['action', 'mark-read']));
    expect(commandTable['send-file']).toBe(get(commandTable, ['media', 'send']));
    expect(commandTable.download).toBe(get(commandTable, ['media', 'download']));
  });
});
