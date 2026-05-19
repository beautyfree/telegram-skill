/**
 * Copy the platform-specific libtdjson to the install directory.
 * Run after `bun build --compile` to ensure the compiled binary can find TDLib.
 *
 * Destination varies by platform:
 *   macOS/Linux: ~/.local/lib/telegram-agent/libtdjson.{dylib,so}
 *   Windows:     %LOCALAPPDATA%/telegram-agent/lib/tdjson.dll
 */

import { copyFileSync, mkdirSync } from 'node:fs';
import { getInstalledTdjsonPath, getLibDir } from '@tg/protocol/paths';
import { getTdjson } from 'prebuilt-tdlib';

const src = getTdjson();
const destDir = getLibDir();
const dest = getInstalledTdjsonPath();

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);

console.log(`Installed: ${src} → ${dest}`);
