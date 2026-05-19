#!/usr/bin/env bun

/**
 * Publishing pipeline for telegram-agent.
 *
 * Publishes 5 platform packages + 1 wrapper package to npm,
 * then generates a Homebrew formula to stdout.
 *
 * Usage:
 *   bun run scripts/publish.ts
 *   bun run scripts/publish.ts --dry-run
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { $ } from 'bun';

const cliDir = path.resolve(import.meta.dir, '..');
process.chdir(cliDir);

const dryRun = process.argv.includes('--dry-run');

const pkg = await Bun.file('package.json').json();
const version = pkg.version;

console.log(`Publishing telegram-agent v${version}${dryRun ? ' (dry run)' : ''}`);

// --- Discover build artifacts ---

import { readdirSync } from 'node:fs';

const platformPattern = /^telegram-agent-(darwin|linux|win32)-(arm64|x64)$/;
const platforms: { os: string; arch: string }[] = [];

for (const entry of readdirSync('dist')) {
  const m = entry.match(platformPattern);
  if (m?.[1] && m[2] && existsSync(`dist/${entry}/package.json`)) {
    platforms.push({ os: m[1], arch: m[2] });
  }
}

if (platforms.length === 0) {
  console.error('No build artifacts found in dist/. Run builds first.');
  process.exit(1);
}

console.log(
  `Found ${platforms.length} platform(s): ${platforms.map((p) => `${p.os}-${p.arch}`).join(', ')}`,
);

// --- Publish platform packages ---

console.log('\nPublishing platform packages...');

const publishTasks = platforms.map(async ({ os, arch }) => {
  const name = `telegram-agent-${os}-${arch}`;
  const distDir = path.resolve(`dist/${name}`);

  if (process.platform !== 'win32') {
    await $`chmod -R 755 ${distDir}`;
  }

  const args = ['npm', 'publish', '--access', 'public'];
  if (dryRun) args.push('--dry-run');
  const result = await $`${args}`.cwd(distDir).nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`Failed to publish ${name}@${version} (exit code ${result.exitCode})`);
  }
  console.log(`  Published ${name}@${version}`);
});

await Promise.all(publishTasks);

// --- Build and publish wrapper package ---

console.log('\nBuilding wrapper package...');

const wrapperDir = 'dist/telegram-agent';
await $`mkdir -p ${wrapperDir}/bin`;
await $`cp bin/telegram-agent.js ${wrapperDir}/bin/telegram-agent.js`;
await $`cp scripts/postinstall.mjs ${wrapperDir}/postinstall.mjs`;

const optionalDependencies: Record<string, string> = {};
for (const { os, arch } of platforms) {
  optionalDependencies[`telegram-agent-${os}-${arch}`] = version;
}

const wrapperPkg = {
  name: 'telegram-agent',
  version,
  description: 'Telegram CLI for AI agents',
  bin: { 'telegram-agent': './bin/telegram-agent.js' },
  scripts: { postinstall: 'node ./postinstall.mjs' },
  optionalDependencies,
  license: 'GPL-3.0',
  repository: {
    type: 'git',
    url: 'https://github.com/beautyfree/telegram-agent',
    directory: 'apps/cli',
  },
  homepage: 'https://github.com/beautyfree/telegram-agent/tree/main/apps/cli#readme',
};

await Bun.file(`${wrapperDir}/package.json`).write(JSON.stringify(wrapperPkg, null, 2));

// Copy LICENSE and README if they exist
const licenseFile = path.resolve('../../LICENSE');
if (existsSync(licenseFile)) {
  await $`cp ${licenseFile} ${wrapperDir}/LICENSE`;
}
const readmeFile = path.resolve('README.md');
if (existsSync(readmeFile)) {
  await $`cp ${readmeFile} ${wrapperDir}/README.md`;
}

console.log('Publishing wrapper package...');
const wrapperArgs = ['npm', 'publish', '--access', 'public'];
if (dryRun) wrapperArgs.push('--dry-run');
const wrapperResult = await $`${wrapperArgs}`.cwd(path.resolve(wrapperDir)).nothrow();
if (wrapperResult.exitCode !== 0) {
  throw new Error(
    `Failed to publish telegram-agent@${version} (exit code ${wrapperResult.exitCode})`,
  );
}
console.log(`  Published telegram-agent@${version}`);

// --- Generate Homebrew formula ---

console.log('\n--- Homebrew Formula ---\n');

async function sha256(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

const archiveFiles: Record<string, string | null> = {};
for (const { os, arch } of platforms) {
  const name = `telegram-agent-${os}-${arch}`;
  const ext = os === 'linux' ? 'tar.gz' : 'zip';
  const archivePath = `dist/${name}.${ext}`;
  archiveFiles[`${os}-${arch}`] = existsSync(archivePath) ? archivePath : null;
}

const shas: Record<string, string> = {};
for (const [key, filePath] of Object.entries(archiveFiles)) {
  if (filePath) {
    shas[key] = await sha256(filePath);
  }
}

const ghBase = `https://github.com/beautyfree/telegram-agent/releases/download/v${version}`;

// Build platform blocks only for platforms that have actual archives (non-empty sha256)
const macosBlocks: string[] = [];
const linuxBlocks: string[] = [];

if (shas['darwin-x64']) {
  macosBlocks.push(`    if Hardware::CPU.intel?
      url "${ghBase}/telegram-agent-darwin-x64.zip"
      sha256 "${shas['darwin-x64']}"
    end`);
}

if (shas['darwin-arm64']) {
  macosBlocks.push(`    if Hardware::CPU.arm?
      url "${ghBase}/telegram-agent-darwin-arm64.zip"
      sha256 "${shas['darwin-arm64']}"
    end`);
}

if (shas['linux-x64']) {
  linuxBlocks.push(`    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?
      url "${ghBase}/telegram-agent-linux-x64.tar.gz"
      sha256 "${shas['linux-x64']}"
    end`);
}

if (shas['linux-arm64']) {
  linuxBlocks.push(`    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?
      url "${ghBase}/telegram-agent-linux-arm64.tar.gz"
      sha256 "${shas['linux-arm64']}"
    end`);
}

const osSections: string[] = [];
if (macosBlocks.length > 0) {
  osSections.push(`  on_macos do\n${macosBlocks.join('\n')}\n  end`);
}
if (linuxBlocks.length > 0) {
  osSections.push(`  on_linux do\n${linuxBlocks.join('\n')}\n  end`);
}

const formula = `# typed: false
# frozen_string_literal: true

class AgentTelegram < Formula
  desc "AI-powered Telegram CLI"
  homepage "https://github.com/beautyfree/telegram-agent"
  version "${version}"

${osSections.join('\n\n')}

  def install
    bin.install "bin/telegram-agent"
    (bin/"prebuilds").install Dir["bin/prebuilds/*"] if (buildpath/"bin/prebuilds").exist?
    (lib/"telegram-agent").install Dir["lib/*"] if (buildpath/"lib").exist?
  end
end
`;

// Write formula to file for the workflow to pick up
const formulaPath = 'dist/telegram-agent.rb';
await writeFile(formulaPath, formula);
console.log(`Formula written to ${formulaPath}`);
console.log(formula);

console.log('Done.');
