/**
 * Unit tests for `saved` reaction-tags command surface.
 *
 * The actions themselves call into TDLib at runtime; we can't exercise that
 * without a real session. What we *can* assert from a unit test is that the
 * command tree is registered, all subcommands are visible in --help, and the
 * argument-parser rejects the obvious misuse cases.
 */

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const CLI_ENTRY = path.resolve(import.meta.dir, '../../src/index.ts');

function help(...args: string[]) {
  const r = spawnSync('bun', ['run', CLI_ENTRY, ...args, '--help'], {
    encoding: 'utf-8',
    timeout: 10_000,
  });
  return (r.stdout ?? '') + (r.stderr ?? '');
}

describe('saved command registration', () => {
  test('saved --help lists all 5 subcommands', () => {
    const out = help('saved');
    for (const sub of ['tags', 'tag-rename', 'default-tags', 'search', 'history']) {
      expect(out).toContain(sub);
    }
  });

  test('saved tag-rename requires <emoji>', () => {
    const out = help('saved', 'tag-rename');
    expect(out).toMatch(/<emoji>/);
  });

  test('saved search advertises --tag / --query / --limit', () => {
    const out = help('saved', 'search');
    expect(out).toContain('--tag');
    expect(out).toContain('--query');
    expect(out).toContain('--limit');
  });

  test('saved history advertises pagination flags', () => {
    const out = help('saved', 'history');
    expect(out).toContain('--limit');
    expect(out).toContain('--offset-id');
  });
});

describe('root help advertises Saved Messages category', () => {
  test('contains "Saved Messages" section header', () => {
    const out = help();
    expect(out).toMatch(/Saved Messages/i);
  });
});
