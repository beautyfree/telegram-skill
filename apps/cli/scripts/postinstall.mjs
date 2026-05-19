#!/usr/bin/env node

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

try {
  const platformMap = { darwin: 'darwin', linux: 'linux', win32: 'win32' };
  const archMap = { x64: 'x64', arm64: 'arm64' };

  const platform = platformMap[os.platform()];
  const arch = archMap[os.arch()];

  if (!platform || !arch) {
    console.log(`tg: no prebuilt binary for ${os.platform()}-${os.arch()}`);
    process.exit(0);
  }

  const packageName = `telegram-agent-${platform}-${arch}`;
  const binaryName = platform === 'win32' ? 'telegram-agent.exe' : 'telegram-agent';

  // Find the platform package binary via require.resolve
  let binaryPath;
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    binaryPath = path.join(path.dirname(packageJsonPath), 'bin', binaryName);
  } catch {
    console.log(`tg: platform package "${packageName}" not installed, skipping`);
    process.exit(0);
  }

  if (!fs.existsSync(binaryPath)) {
    console.log(`tg: binary not found at ${binaryPath}, skipping`);
    process.exit(0);
  }

  // Create hardlink at bin/.tg so the wrapper can exec it directly
  // In the published telegram-agent package, postinstall.mjs and bin/ are siblings at root
  const binDir = path.join(__dirname, 'bin');
  const target = path.join(binDir, '.tg');

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }

  try {
    fs.linkSync(binaryPath, target);
  } catch {
    // Hardlink failed (cross-device), fall back to copy
    fs.copyFileSync(binaryPath, target);
  }

  if (platform !== 'win32') {
    fs.chmodSync(target, 0o755);
  }

  console.log(`tg: binary linked for ${platform}-${arch}`);

  // Copy tdl.node prebuilds next to the hardlinked binary so node-gyp-build finds them
  const prebuildsSrc = path.join(path.dirname(binaryPath), 'prebuilds');
  if (fs.existsSync(prebuildsSrc)) {
    const prebuildsTarget = path.join(binDir, 'prebuilds');
    try {
      fs.cpSync(prebuildsSrc, prebuildsTarget, { recursive: true });
      console.log(`tg: tdl.node prebuilds installed`);
    } catch (e) {
      console.log(`tg: could not copy prebuilds (${e.message})`);
    }
  }

  // Copy libtdjson to ~/.local/lib/telegram-agent/ so the daemon can find it
  const libSrcDir = path.join(path.dirname(binaryPath), '..', 'lib');
  const tdjsonNames = { darwin: 'libtdjson.dylib', linux: 'libtdjson.so', win32: 'tdjson.dll' };
  const tdjsonName = tdjsonNames[platform];

  if (tdjsonName) {
    const tdjsonSrc = path.join(libSrcDir, tdjsonName);
    if (fs.existsSync(tdjsonSrc)) {
      const libDestDir =
        platform === 'win32'
          ? path.join(
              process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
              'telegram-agent',
              'lib',
            )
          : path.join(os.homedir(), '.local', 'lib', 'telegram-agent');
      fs.mkdirSync(libDestDir, { recursive: true });
      const tdjsonDest = path.join(libDestDir, tdjsonName);
      try {
        fs.copyFileSync(tdjsonSrc, tdjsonDest);
        console.log(`tg: tdjson installed to ${libDestDir}`);
      } catch (e) {
        console.log(`tg: could not copy tdjson (${e.message})`);
      }
    }
  }
} catch (error) {
  // Postinstall must never fail the install
  console.log(`tg: postinstall skipped (${error.message})`);
  process.exit(0);
}
