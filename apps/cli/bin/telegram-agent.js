#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function run(target) {
  const result = require('node:child_process').spawnSync(target, process.argv.slice(2), {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(typeof result.status === 'number' ? result.status : 0);
}

// Allow override via environment variable
const envPath = process.env.TG_BIN_PATH;
if (envPath) {
  run(envPath);
}

const scriptDir = path.dirname(fs.realpathSync(__filename));

// Check for cached hardlink from postinstall
const cached = path.join(scriptDir, '.tg');
if (fs.existsSync(cached)) {
  run(cached);
}

// Platform/arch detection
const platformMap = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'win32',
};
const archMap = {
  x64: 'x64',
  arm64: 'arm64',
};

const platform = platformMap[os.platform()];
const arch = archMap[os.arch()];

if (!platform || !arch) {
  console.error(
    `Unsupported platform: ${os.platform()}-${os.arch()}\n` +
      'telegram-agent supports: darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-x64',
  );
  process.exit(1);
}

const packageName = `@avemeva/telegram-agent-${platform}-${arch}`;
const binary = platform === 'win32' ? 'telegram-agent.exe' : 'telegram-agent';

// Walk up from script directory to find node_modules
function findBinary(startDir) {
  let current = startDir;
  for (;;) {
    const candidate = path.join(current, 'node_modules', packageName, 'bin', binary);
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const resolved = findBinary(scriptDir);
if (!resolved) {
  console.error(
    `Could not find the "${packageName}" package.\n\n` +
      'Your package manager may have failed to install the platform-specific binary.\n' +
      'Try reinstalling: npm i -g @avemeva/telegram-agent\n\n' +
      `If your platform (${os.platform()}-${os.arch()}) is not supported, ` +
      'see https://github.com/avemeva/kurier for alternatives.',
  );
  process.exit(1);
}

run(resolved);
