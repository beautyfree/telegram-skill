/**
 * Caption daemon — standalone background process that keeps the Florence-2 model loaded.
 *
 * Triggered by `tg --caption-daemon`. Shuts down after 5 min of inactivity.
 * HTTP on localhost with /health and /caption endpoints.
 * PID/port written to APP_DIR for client-side lifecycle management.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { APP_DIR } from '@tg/protocol/paths';

const MODEL_ID = 'onnx-community/Florence-2-base';
const MODELS_DIR = path.join(APP_DIR, 'models');
const DTYPE = 'q4';
const PID_FILE = path.join(APP_DIR, 'caption.pid');
const PORT_FILE = path.join(APP_DIR, 'caption.port');
const DEFAULT_PORT = 7313;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const LOG_FILE = path.join(APP_DIR, 'caption.log');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeUnlink(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Already removed or never existed
  }
}

function cleanupFiles(): void {
  safeUnlink(PID_FILE);
  safeUnlink(PORT_FILE);
}

function captionLog(msg: string): void {
  const ts = new Date().toISOString();
  appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Daemon entry point
// ---------------------------------------------------------------------------

export async function runCaptionDaemon(): Promise<void> {
  mkdirSync(APP_DIR, { recursive: true });

  // Check for existing daemon
  if (existsSync(PID_FILE)) {
    try {
      const pid = Number(readFileSync(PID_FILE, 'utf-8').trim());
      if (pid > 0) {
        process.kill(pid, 0); // throws if dead
        captionLog(`Caption daemon already running at PID ${pid}`);
        process.exit(0);
      }
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'EPERM') {
        captionLog('Caption daemon already running (EPERM)');
        process.exit(0);
      }
      // ESRCH = stale PID file — remove and continue
      safeUnlink(PID_FILE);
    }
  }

  writeFileSync(PID_FILE, String(process.pid));

  const port = Number(process.env.TG_CAPTION_PORT) || DEFAULT_PORT;

  captionLog('Loading Florence-2 model...');

  // ---------------------------------------------------------------------------
  // Load model (WebGPU → CPU fallback)
  // ---------------------------------------------------------------------------

  // biome-ignore lint/suspicious/noExplicitAny: dynamically imported, types unavailable in compiled binary
  let Florence2ForConditionalGeneration: any, AutoProcessor: any, RawImage: any;
  try {
    ({ Florence2ForConditionalGeneration, AutoProcessor, RawImage } = await import(
      '@huggingface/transformers'
    ));
  } catch {
    captionLog(
      'Caption feature requires @huggingface/transformers. Install it with: bun add @huggingface/transformers',
    );
    process.exit(1);
  }

  let device: 'webgpu' | 'cpu' = 'webgpu';
  // biome-ignore lint/suspicious/noExplicitAny: dynamically imported model instance
  let model: any;

  const processorPromise = AutoProcessor.from_pretrained(MODEL_ID, { cache_dir: MODELS_DIR });

  try {
    model = await Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, {
      cache_dir: MODELS_DIR,
      dtype: DTYPE,
      device: 'webgpu',
    });
  } catch {
    device = 'cpu';
    model = await Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, {
      cache_dir: MODELS_DIR,
      dtype: DTYPE,
      device: 'cpu',
    });
  }

  const processor = await processorPromise;

  writeFileSync(PORT_FILE, String(port));
  captionLog(`Caption daemon ready (PID ${process.pid}, port ${port}, device ${device})`);

  // ---------------------------------------------------------------------------
  // Idle timer
  // ---------------------------------------------------------------------------

  let idleTimer: ReturnType<typeof setTimeout>;

  function resetIdle(): void {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      captionLog('Idle timeout reached, shutting down');
      shutdown();
    }, IDLE_TIMEOUT_MS);
  }

  resetIdle();

  // ---------------------------------------------------------------------------
  // HTTP server
  // ---------------------------------------------------------------------------

  Bun.serve({
    port,
    fetch: async (req) => {
      const url = new URL(req.url);

      if (url.pathname === '/health') {
        resetIdle();
        return Response.json({ ok: true, model: MODEL_ID, dtype: DTYPE, device, pid: process.pid });
      }

      if (url.pathname === '/caption' && req.method === 'POST') {
        resetIdle();
        try {
          const body = (await req.json()) as { files: string[]; maxTokens?: number };
          const maxTokens = body.maxTokens ?? 30;
          const task = '<CAPTION>';
          const results: { file: string; text: string }[] = [];

          for (const file of body.files) {
            if (!existsSync(file)) {
              return Response.json({ error: `File not found: ${file}` }, { status: 400 });
            }
            const image = await RawImage.read(file);
            // biome-ignore lint/suspicious/noExplicitAny: Florence-2 processor methods not in base Processor type
            const fp = processor as any;
            const prompts = fp.construct_prompts(task);
            const inputs = await processor(image, prompts);
            const generated = await model.generate({ ...inputs, max_new_tokens: maxTokens });
            // biome-ignore lint/suspicious/noExplicitAny: batch_decode returns Florence-2 specific output
            const decoded = processor.batch_decode(generated as any, {
              skip_special_tokens: false,
            });
            const parsed = fp.post_process_generation(decoded[0], task, image.size);
            const text =
              parsed[task] ?? (typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
            results.push({ file, text });
          }

          return Response.json(results.length === 1 ? results[0] : results);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          captionLog(`Caption error: ${msg}`);
          return Response.json({ error: msg }, { status: 500 });
        }
      }

      return Response.json({ error: 'not found' }, { status: 404 });
    },
  });

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    captionLog('Shutting down...');
    clearTimeout(idleTimer);
    cleanupFiles();
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
  process.on('SIGHUP', () => shutdown());

  process.on('uncaughtException', (err) => {
    captionLog(`Uncaught exception: ${err.message}`);
    cleanupFiles();
    process.exit(1);
  });

  process.on('unhandledRejection', (err: unknown) => {
    captionLog(`Unhandled rejection: ${(err as Error)?.message ?? err}`);
    cleanupFiles();
    process.exit(1);
  });

  process.on('exit', cleanupFiles);

  // Keep alive — Bun.serve keeps the event loop running
  await new Promise<never>(() => {});
}
