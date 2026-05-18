/**
 * Caption daemon — standalone background process keeping Florence-2 loaded.
 *
 * Spawned via `telegram-agent --caption-daemon`. HTTP on 127.0.0.1:7313 by
 * default (TG_CAPTION_PORT to override). Endpoints:
 *   GET  /health           → { ok, model, dtype, device, pid }
 *   POST /caption          → { file, text } | [{ file, text }, ...]
 *     body: { files: string[], maxTokens?: number }
 *
 * Idle-exits after 5 min of no requests. PID and port written to
 * `~/.telegram-agent/caption.{pid,port}` for client-side lifecycle.
 *
 * Architecture mirrors avemeva/kurier's caption-daemon. We use Node's
 * built-in `http` instead of Bun.serve, and Node's child_process spawn
 * for detach instead of Bun.spawn.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';

import { captionPaths, MODEL_ID, MODEL_DTYPE, CAPTION_DEFAULT_PORT, CAPTION_IDLE_MS } from './paths.js';

function safeUnlink(p: string): void {
  try {
    unlinkSync(p);
  } catch {
    // already gone
  }
}

function cleanupFiles(): void {
  const { pidFile, portFile } = captionPaths();
  safeUnlink(pidFile);
  safeUnlink(portFile);
}

function captionLog(msg: string): void {
  const { logFile } = captionPaths();
  const ts = new Date().toISOString();
  try {
    appendFileSync(logFile, `[${ts}] ${msg}\n`);
  } catch {
    // logging is best-effort — disk may be read-only in some environments
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
  });
  res.end(buf);
}

export async function runCaptionDaemon(): Promise<void> {
  const { baseDir, modelsDir, pidFile, portFile } = captionPaths();
  mkdirSync(baseDir, { recursive: true });
  mkdirSync(modelsDir, { recursive: true });

  // If another caption daemon owns the PID file and is alive, exit clean.
  if (existsSync(pidFile)) {
    try {
      const pid = Number(readFileSync(pidFile, 'utf-8').trim());
      if (pid > 0) {
        process.kill(pid, 0); // throws ESRCH if dead
        captionLog(`caption daemon already running at PID ${pid}, exiting`);
        process.exit(0);
      }
    } catch (e: any) {
      if (e?.code === 'EPERM') {
        // Process exists but we can't signal — assume alive.
        captionLog('caption daemon already running (EPERM on probe), exiting');
        process.exit(0);
      }
      // ESRCH → stale, remove.
      safeUnlink(pidFile);
    }
  }
  writeFileSync(pidFile, String(process.pid), { mode: 0o600 });

  const port = Number(process.env.TG_CAPTION_PORT) || CAPTION_DEFAULT_PORT;

  captionLog('loading Florence-2 model…');

  // Dynamic import — @huggingface/transformers is an optional peer dep so the
  // base CLI install stays slim. If it's missing, surface a friendly error.
  let Florence2ForConditionalGeneration: any;
  let AutoProcessor: any;
  let RawImage: any;
  try {
    // String-built specifier sidesteps TS's static module resolution —
    // @huggingface/transformers is an optional peer dep, won't be present
    // at typecheck time. Resolved at runtime when the caption daemon
    // actually boots.
    const specifier = '@hug' + 'gingface/transformers';
    ({ Florence2ForConditionalGeneration, AutoProcessor, RawImage } = await import(specifier));
  } catch {
    captionLog(
      'caption feature requires @huggingface/transformers — install with `npm i -g @huggingface/transformers`',
    );
    cleanupFiles();
    process.exit(1);
  }

  // Try WebGPU first (Mac M-series, modern dGPUs) → CPU fallback.
  let device: 'webgpu' | 'cpu' = 'webgpu';
  let model: any;
  const processorPromise = AutoProcessor.from_pretrained(MODEL_ID, { cache_dir: modelsDir });

  try {
    model = await Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, {
      cache_dir: modelsDir,
      dtype: MODEL_DTYPE,
      device: 'webgpu',
    });
  } catch {
    device = 'cpu';
    model = await Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, {
      cache_dir: modelsDir,
      dtype: MODEL_DTYPE,
      device: 'cpu',
    });
  }
  const processor = await processorPromise;

  writeFileSync(portFile, String(port), { mode: 0o600 });
  captionLog(`caption daemon ready (pid=${process.pid} port=${port} device=${device})`);

  // Idle timer — re-armed on every request.
  let idleTimer: NodeJS.Timeout | undefined;
  const resetIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      captionLog('idle timeout — shutting down');
      shutdown();
    }, CAPTION_IDLE_MS);
  };
  resetIdle();

  const server = createServer(async (req, res) => {
    try {
      if (!req.url) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      const url = new URL(req.url, `http://localhost:${port}`);

      if (url.pathname === '/health') {
        resetIdle();
        sendJson(res, 200, { ok: true, model: MODEL_ID, dtype: MODEL_DTYPE, device, pid: process.pid });
        return;
      }

      if (url.pathname === '/caption' && req.method === 'POST') {
        resetIdle();
        const body = JSON.parse(await readBody(req)) as { files: string[]; maxTokens?: number };
        const maxTokens = body.maxTokens ?? 60;
        const task = '<CAPTION>';
        const results: { file: string; text: string }[] = [];

        for (const file of body.files) {
          if (!existsSync(file)) {
            sendJson(res, 400, { error: `File not found: ${file}` });
            return;
          }
          const image = await RawImage.read(file);
          const fp = processor as any;
          const prompts = fp.construct_prompts(task);
          const inputs = await processor(image, prompts);
          const generated = await model.generate({ ...inputs, max_new_tokens: maxTokens });
          const decoded = processor.batch_decode(generated as any, { skip_special_tokens: false });
          const parsed = fp.post_process_generation(decoded[0], task, image.size);
          const text = parsed?.[task] ?? (typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
          results.push({ file, text });
        }

        sendJson(res, 200, results.length === 1 ? results[0] : results);
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      captionLog(`request error: ${msg}`);
      sendJson(res, 500, { error: msg });
    }
  });

  // Bind localhost-only — never expose the model on the network.
  server.listen(port, '127.0.0.1');

  let shuttingDown = false;
  function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    captionLog('shutting down');
    if (idleTimer) clearTimeout(idleTimer);
    server.close(() => {
      cleanupFiles();
      process.exit(0);
    });
    // Hard-stop after 2s if close hangs.
    setTimeout(() => {
      cleanupFiles();
      process.exit(0);
    }, 2000).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
  process.on('exit', cleanupFiles);
  process.on('uncaughtException', (err) => {
    captionLog(`uncaught: ${err.message}`);
    cleanupFiles();
    process.exit(1);
  });
  process.on('unhandledRejection', (err: any) => {
    captionLog(`unhandled rejection: ${err?.message ?? err}`);
    cleanupFiles();
    process.exit(1);
  });

  // The http server keeps the event loop alive; nothing else to do here.
  void join; // silence unused-import lint
}
