#!/usr/bin/env bun

/**
 * Release a new version of telegram-agent.
 *
 * Usage:
 *   bun run release patch   # 0.1.0 → 0.1.1
 *   bun run release minor   # 0.1.0 → 0.2.0
 *   bun run release major   # 0.1.0 → 1.0.0
 *
 * What it does:
 *   1. Bumps version in package.json
 *   2. Commits the version bump
 *   3. Creates a git tag (v0.1.1)
 *   4. Pushes commit + tag → triggers CI publish workflow
 */

import path from 'node:path';
import { $ } from 'bun';

const cliDir = path.resolve(import.meta.dir, '..');
process.chdir(cliDir);

const bump = process.argv[2];
if (!bump || !['patch', 'minor', 'major'].includes(bump)) {
  console.error('Usage: bun run release <patch|minor|major>');
  process.exit(1);
}

// Ensure clean working tree
const status = await $`git status --porcelain`.text();
if (status.trim()) {
  console.error('Working tree is not clean. Commit or stash changes first.');
  process.exit(1);
}

// Read current version
const pkg = await Bun.file('package.json').json();
const current = pkg.version;

// Compute new version
const [major, minor, patch] = current.split('.').map(Number);
const next =
  bump === 'major'
    ? `${major + 1}.0.0`
    : bump === 'minor'
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

const tag = `v${next}`;

console.log(`${current} → ${next}`);
console.log();

// Update package.json
pkg.version = next;
await Bun.file('package.json').write(`${JSON.stringify(pkg, null, 2)}\n`);

// Commit, tag, push
await $`git add package.json`;
await $`git commit -m ${`release: telegram-agent ${tag}`}`;
await $`git tag ${tag}`;
await $`git push && git push --tags`;

console.log();
console.log(`Released ${tag} — CI will build and publish.`);
console.log(`Track: https://github.com/beautyfree/telegram-agent/actions`);
