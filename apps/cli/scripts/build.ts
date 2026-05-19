/**
 * Build the CLI binary with hardcoded API credentials.
 *
 * Uses `bun build --compile` for the current platform only.
 * Embeds API credentials via --define at compile time.
 *
 * Flags:
 *   --single   Install to ~/.local/bin/ and ~/.local/lib/ after build
 *   --release  Create distributable archive after building
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { $ } from 'bun';

const cliDir = path.resolve(import.meta.dir, '..');
process.chdir(cliDir);

const pkg = await Bun.file('package.json').json();

// --- Flags ---

const singleFlag = process.argv.includes('--single');
const releaseFlag = process.argv.includes('--release');

// --- Resolve credentials (same search order as loadCredentials) ---

function findCredentials(): { apiId: number; apiHash: string } {
  const envId = process.env.TG_API_ID ?? process.env.VITE_TG_API_ID;
  const envHash = process.env.TG_API_HASH ?? process.env.VITE_TG_API_HASH;
  if (envId && envHash) {
    const apiId = Number(envId);
    if (apiId && envHash) return { apiId, apiHash: envHash };
  }

  const candidates = [
    path.join(homedir(), '.config', 'telegram-agent', 'credentials'),
    path.join(homedir(), 'Library', 'Application Support', 'dev.telegramai.app', '.env'),
    path.resolve('../../.env'), // monorepo root
  ];

  for (const filePath of candidates) {
    try {
      const text = readFileSync(filePath, 'utf-8');
      const vars: Record<string, string> = {};
      for (const line of text.split('\n')) {
        const m = line.match(/^(\w+)=(.*)$/);
        if (m?.[1] && m[2] !== undefined) vars[m[1]] = m[2];
      }
      const apiId = Number(vars.TG_API_ID ?? vars.VITE_TG_API_ID);
      const apiHash = vars.TG_API_HASH ?? vars.VITE_TG_API_HASH ?? '';
      if (apiId && apiHash) return { apiId, apiHash };
    } catch {
      // Try next
    }
  }

  throw new Error(
    'Cannot build: API credentials not found.\n' +
      'Set TG_API_ID and TG_API_HASH environment variables, or create .env in the monorepo root.',
  );
}

// --- Build for current platform ---

const os = process.platform;
const arch = process.arch as 'arm64' | 'x64';
const name = `telegram-agent-${os}-${arch}`;
const bunTarget = `bun-${os}-${arch}`;
const outfile = `dist/${name}/bin/telegram-agent`;

const { apiId, apiHash } = findCredentials();
console.log(`Building ${name} v${pkg.version} (API ID: ${apiId})`);

await $`rm -rf dist`;
await $`mkdir -p dist/${name}/bin`;

const result = Bun.spawnSync(
  [
    'bun',
    'build',
    'src/index.ts',
    '--compile',
    '--target',
    bunTarget,
    '--external',
    '@huggingface/transformers',
    '--outfile',
    outfile,
    '--define',
    `process.env.TG_BUILTIN_API_ID="${apiId}"`,
    '--define',
    `process.env.TG_BUILTIN_API_HASH="${apiHash}"`,
    '--define',
    `process.env.TG_VERSION="${pkg.version}"`,
  ],
  { stdio: ['inherit', 'inherit', 'inherit'] },
);

if (result.exitCode !== 0) {
  console.error(`Build failed for ${name}`);
  process.exit(result.exitCode ?? 1);
}

// Platform package.json for npm publishing
await Bun.file(`dist/${name}/package.json`).write(
  JSON.stringify(
    {
      name: `@avemeva/${name}`,
      version: pkg.version,
      os: [os],
      cpu: [arch],
      files: ['bin', 'lib'],
      repository: {
        type: 'git',
        url: 'https://github.com/avemeva/kurier',
      },
    },
    null,
    2,
  ),
);

// Copy tdjson into dist
try {
  const { getTdjson } = await import('prebuilt-tdlib');
  const { getTdjsonFilename } = await import('@tg/protocol/paths');
  const tdjsonSrc = getTdjson();
  const tdjsonDest = `dist/${name}/lib/${getTdjsonFilename()}`;
  mkdirSync(`dist/${name}/lib`, { recursive: true });
  copyFileSync(tdjsonSrc, tdjsonDest);
  console.log(`Bundled tdjson: ${tdjsonDest}`);
} catch (e) {
  console.warn(`Warning: Could not bundle tdjson: ${e}`);
}

// Copy tdl.node native addon into dist
// File names vary by platform: tdl.node (darwin/win32), tdl.glibc.node (linux-x64), tdl.armv8.glibc.node (linux-arm64)
try {
  const prebuildsDir = `prebuilds/${os}-${arch}`;
  const tdlSrcDir = path.resolve(`../../node_modules/tdl/${prebuildsDir}`);
  const tdlDestDir = `dist/${name}/bin/${prebuildsDir}`;
  mkdirSync(tdlDestDir, { recursive: true });
  const nodeFiles = readdirSync(tdlSrcDir).filter((f) => f.endsWith('.node'));
  if (nodeFiles.length === 0) throw new Error(`No .node files in ${tdlSrcDir}`);
  for (const file of nodeFiles) {
    copyFileSync(path.join(tdlSrcDir, file), path.join(tdlDestDir, file));
  }
  console.log(`Bundled tdl prebuilds: ${nodeFiles.join(', ')} → ${tdlDestDir}`);
} catch (e) {
  console.warn(`Warning: Could not bundle tdl.node: ${e}`);
}

const binaries: Record<string, string> = { [name]: pkg.version };
console.log(`Built ${name}`);

// --- Single mode: install locally ---

if (singleFlag) {
  const builtBinary = path.resolve(`dist/${name}/bin/telegram-agent`);
  const installPath = path.join(homedir(), '.local', 'bin', 'telegram-agent');

  mkdirSync(path.dirname(installPath), { recursive: true });
  copyFileSync(builtBinary, installPath);
  console.log(`Installed binary: ${installPath}`);

  // Copy tdjson to lib dir
  const { getLibDir, getTdjsonFilename } = await import('@tg/protocol/paths');
  const libDir = getLibDir();
  mkdirSync(libDir, { recursive: true });
  copyFileSync(`dist/${name}/lib/${getTdjsonFilename()}`, path.join(libDir, getTdjsonFilename()));
  console.log(`Installed tdjson: ${libDir}`);

  // Copy tdl.node native addon next to the binary
  try {
    const prebuildsDir = `prebuilds/${os}-${arch}`;
    const tdlSrcDir = path.resolve(`dist/${name}/bin/${prebuildsDir}`);
    const tdlDestDir = path.join(homedir(), '.local', 'bin', prebuildsDir);
    mkdirSync(tdlDestDir, { recursive: true });
    const nodeFiles = readdirSync(tdlSrcDir).filter((f) => f.endsWith('.node'));
    for (const file of nodeFiles) {
      copyFileSync(path.join(tdlSrcDir, file), path.join(tdlDestDir, file));
    }
    console.log(`Installed tdl prebuilds: ${nodeFiles.join(', ')} → ${tdlDestDir}`);
  } catch (e) {
    console.warn(`Warning: Could not install tdl.node: ${e}`);
  }

  // Create ~/.tg symlink -> media_cache
  if (process.platform !== 'win32') {
    const { getAppDir } = await import('@tg/protocol/paths');
    const mediaCacheDir = path.join(getAppDir(), 'media_cache');
    const symlink = path.join(homedir(), '.tg');

    mkdirSync(mediaCacheDir, { recursive: true });

    try {
      if (existsSync(symlink)) {
        const current = readlinkSync(symlink);
        if (current !== mediaCacheDir) {
          unlinkSync(symlink);
          symlinkSync(mediaCacheDir, symlink);
          console.log(`Updated symlink: ${symlink} -> ${mediaCacheDir}`);
        }
      } else {
        symlinkSync(mediaCacheDir, symlink);
        console.log(`Created symlink: ${symlink} -> ${mediaCacheDir}`);
      }
    } catch (err) {
      console.warn(`Could not create symlink ${symlink}: ${err}`);
    }
  }
}

// --- Release mode: create archive ---

if (releaseFlag) {
  const distDir = path.resolve(`dist/${name}`);
  const dirs = ['bin'];
  if (existsSync(`dist/${name}/lib`)) dirs.push('lib');

  if (os === 'linux') {
    await $`tar -czf ../${name}.tar.gz ${dirs}`.cwd(distDir);
  } else if (os === 'win32') {
    // Windows CI doesn't have zip; use PowerShell Compress-Archive
    const zipPath = path.resolve(`dist/${name}.zip`);
    const sources = dirs.map((d) => path.join(distDir, d)).join(',');
    Bun.spawnSync(
      ['powershell', '-Command', `Compress-Archive -Path ${sources} -DestinationPath '${zipPath}'`],
      { stdio: ['inherit', 'inherit', 'inherit'] },
    );
  } else {
    await $`zip -r ../${name}.zip ${dirs}`.cwd(distDir);
  }
  console.log(`Archived ${name} (${dirs.join(', ')})`);
}

console.log(`Done: ${name}`);

export { binaries };
