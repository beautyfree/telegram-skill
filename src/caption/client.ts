/**
 * Caption daemon client — spawn/wait/ensure + `/caption` POST.
 *
 * Mirrors src/daemon/* patterns. The caption daemon is auto-started on
 * first call and shuts down on idle. We talk to it over localhost HTTP
 * (not the unix socket we use for the main daemon) because the model
 * load is so much heavier — easier to debug + monitor in isolation.
 */
import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';

import {
  captionPaths,
  CAPTION_DEFAULT_PORT,
} from './paths.js';

function readCaptionPid(): number | null {
  const { pidFile } = captionPaths();
  try {
    const raw = readFileSync(pidFile, 'utf-8').trim();
    const pid = Number(raw);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    process.kill(pid, 0); // signal 0 = existence check
    return pid;
  } catch {
    return null;
  }
}

function readCaptionPort(): number {
  const { portFile } = captionPaths();
  try {
    const raw = readFileSync(portFile, 'utf-8').trim();
    const port = Number(raw);
    if (port > 0 && port < 65536) return port;
  } catch {
    // not ready
  }
  return CAPTION_DEFAULT_PORT;
}

function spawnCaptionDaemon(): void {
  // We re-exec the CLI with the `--caption-daemon` sentinel. The script
  // path is the running entry — when invoked through `npm i -g`, that's
  // `dist/cli.js` under the global prefix.
  const script = process.argv[1];
  if (!script) {
    throw new Error('Cannot spawn caption daemon: process.argv[1] is empty');
  }
  const child = spawn(process.execPath, [script, '--caption-daemon'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();
}

async function waitForCaptionDaemon(port: number, timeoutMs = 60_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/**
 * Ensure the caption daemon is running. Spawns it if needed, waits for
 * `/health` to respond. 60 s timeout accommodates first-run model
 * download (~30 s on a fresh install).
 */
export async function ensureCaptionDaemon(): Promise<string> {
  if (!readCaptionPid()) spawnCaptionDaemon();

  let port = readCaptionPort();
  let ready = await waitForCaptionDaemon(port);
  if (!ready) {
    // Port file may have been written after first probe; re-read once.
    const retry = readCaptionPort();
    if (retry !== port) {
      ready = await waitForCaptionDaemon(retry, 10_000);
      port = retry;
    }
  }
  if (!ready) {
    throw new Error(
      'Caption daemon did not become ready within 60 s. ' +
        'First call downloads ~150 MB of Florence-2 weights — give it another minute, ' +
        'or check `tail -f ~/.telegram-agent/caption.log`.',
    );
  }
  return `http://127.0.0.1:${port}`;
}

export interface CaptionResult {
  file: string;
  text: string;
}

/**
 * Caption one or more local image files via the caption daemon.
 * Auto-spawns the daemon if not running.
 */
export async function captionFiles(
  files: string[],
  maxTokens?: number,
): Promise<CaptionResult | CaptionResult[]> {
  const url = await ensureCaptionDaemon();
  const res = await fetch(`${url}/caption`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files, maxTokens }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // body wasn't JSON — keep status fallback
    }
    throw new Error(`Caption error: ${detail}`);
  }
  return (await res.json()) as CaptionResult | CaptionResult[];
}

export function isCaptionDaemonRunning(): boolean {
  return readCaptionPid() !== null;
}
