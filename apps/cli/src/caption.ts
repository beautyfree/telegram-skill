/**
 * Caption daemon client lifecycle — spawn, check, wait, ensure.
 *
 * Mirrors daemon.ts patterns for the caption daemon process.
 * The caption daemon is auto-started when needed and communicates over HTTP.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { APP_DIR } from '@tg/protocol/paths';

const MODEL_ID = 'onnx-community/Florence-2-base';
const MODELS_DIR = path.join(APP_DIR, 'models');
const DTYPE = 'q4';
const PID_FILE = path.join(APP_DIR, 'caption.pid');
const PORT_FILE = path.join(APP_DIR, 'caption.port');
const DEFAULT_PORT = 7313;

// ---------------------------------------------------------------------------
// PID / port helpers
// ---------------------------------------------------------------------------

function getCaptionPid(): number | null {
  try {
    const raw = readFileSync(PID_FILE, 'utf-8').trim();
    const pid = Number(raw);
    if (Number.isNaN(pid) || pid <= 0) return null;
    process.kill(pid, 0); // signal 0 = existence check
    return pid;
  } catch {
    return null;
  }
}

function getCaptionPort(): number {
  try {
    const raw = readFileSync(PORT_FILE, 'utf-8').trim();
    const port = Number(raw);
    if (port > 0 && port < 65536) return port;
  } catch {
    // Port file doesn't exist or is unreadable
  }
  return DEFAULT_PORT;
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

function getSpawnArgs(): string[] {
  const maybeScript = process.argv[1];
  if (maybeScript?.endsWith('.ts') || maybeScript?.endsWith('.js')) {
    return [process.execPath, maybeScript, '--caption-daemon'];
  }
  return [process.execPath, '--caption-daemon'];
}

function spawnCaptionDaemon(): void {
  const args = getSpawnArgs();
  const child = Bun.spawn(args, {
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env },
  });
  child.unref();
}

// ---------------------------------------------------------------------------
// Wait / ensure
// ---------------------------------------------------------------------------

async function waitForCaptionDaemon(port: number, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return true;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/**
 * Ensure the caption daemon is running. Spawns it if needed and waits for health.
 * Returns the base URL. 30s timeout for model loading.
 */
export async function ensureCaptionDaemon(): Promise<string> {
  if (!getCaptionPid()) {
    spawnCaptionDaemon();
  }

  const port = getCaptionPort();
  const url = `http://localhost:${port}`;

  const ready = await waitForCaptionDaemon(port);
  if (!ready) {
    // Port file might not exist yet — re-read after spawn
    const retryPort = getCaptionPort();
    if (retryPort !== port) {
      const retryUrl = `http://localhost:${retryPort}`;
      const retryReady = await waitForCaptionDaemon(retryPort, 5000);
      if (retryReady) return retryUrl;
    }
    throw new Error(
      'Caption model did not load within 30s. Is it downloaded? Run "tg caption download".',
    );
  }

  return url;
}

// ---------------------------------------------------------------------------
// Caption API
// ---------------------------------------------------------------------------

/**
 * Caption one or more image files via the caption daemon.
 * Auto-spawns the daemon if not running.
 */
export async function captionFiles(
  files: string[],
  maxTokens?: number,
): Promise<{ file: string; text: string }[] | { file: string; text: string }> {
  const url = await ensureCaptionDaemon();

  const res = await fetch(`${url}/caption`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, maxTokens }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Caption error: ${err}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Model management
// ---------------------------------------------------------------------------

/** Check if the Florence-2 model files are downloaded. */
export function isModelDownloaded(): boolean {
  return existsSync(MODELS_DIR);
}

/** Download the Florence-2 model with progress output to stderr. */
export async function downloadModel(): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: dynamically imported, types unavailable in compiled binary
  let Florence2ForConditionalGeneration: any, AutoProcessor: any;
  try {
    ({ Florence2ForConditionalGeneration, AutoProcessor } = await import(
      '@huggingface/transformers'
    ));
  } catch {
    console.error(
      'Caption feature requires @huggingface/transformers. Install it with: bun add @huggingface/transformers',
    );
    process.exit(1);
  }

  function progressCallback(info: {
    status: string;
    file?: string;
    progress?: number;
    loaded?: number;
    total?: number;
  }) {
    if (info.status === 'progress' && info.file && info.progress !== undefined) {
      const pct = Math.round(info.progress);
      const mb = info.loaded ? `${(info.loaded / 1e6).toFixed(1)}` : '?';
      const totalMb = info.total ? `${(info.total / 1e6).toFixed(1)}` : '?';
      const name = info.file.split('/').pop();
      process.stderr.write(`\r[download] ${name}: ${pct}% (${mb}/${totalMb} MB)`);
    } else if (info.status === 'done') {
      process.stderr.write('\n');
    }
  }

  await AutoProcessor.from_pretrained(MODEL_ID, {
    cache_dir: MODELS_DIR,
    progress_callback: progressCallback,
  });

  await Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, {
    cache_dir: MODELS_DIR,
    dtype: DTYPE,
    progress_callback: progressCallback,
  });
}
