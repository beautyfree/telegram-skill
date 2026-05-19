import path from 'node:path';
import { getTdjson } from 'prebuilt-tdlib';
import tdl from 'tdl';
import type * as Td from 'tdlib-types';
import type { Invoke } from 'tdlib-types';
import { DB_DIR, FILES_DIR } from '../paths';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DB_DIR = DB_DIR;
const DEFAULT_FILES_DIR = FILES_DIR;
const DEFAULT_PORT = 7312;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
} as const;

const bigIntReplacer = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

// ---------------------------------------------------------------------------
// MIME type mapping
// ---------------------------------------------------------------------------

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  tgs: 'application/x-tgsticker',
  webm: 'video/webm',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
  bin: 'application/octet-stream',
};

function mimeFromExtension(ext: string): string {
  return EXT_MIME[ext.toLowerCase()] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ProxyOptions {
  /** Telegram API ID. Required when `client` is not provided. */
  apiId?: number;
  /** Telegram API hash. Required when `client` is not provided. */
  apiHash?: string;
  /** Port to listen on. Default: 7312 */
  port?: number;
  /** TDLib database directory. Default: ~/Library/Application Support/dev.telegramai.app/tdlib_db */
  databaseDirectory?: string;
  /** TDLib files directory. Default: ~/Library/Application Support/dev.telegramai.app/media_cache */
  filesDirectory?: string;
  /** Path to libtdjson shared library. Default: resolved by prebuilt-tdlib. */
  tdjson?: string;
  /** Pre-created TDLib client for testing. When provided, skips TDLib initialization and auth waiting. */
  client?: tdl.Client;
}

export interface ProxyHandle {
  /** The actual port the server is listening on. */
  port: number;
  /** Full base URL, e.g. "http://localhost:7312" */
  url: string;
  /** The underlying TDLib client (for advanced usage). */
  client: tdl.Client;
  /** Stop the proxy server and close TDLib client. */
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// JSON response helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, bigIntReplacer), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function okResponse(data: unknown): Response {
  return jsonResponse({ ok: true, data });
}

function errResponse(message: string, _code: string, status = 400): Response {
  return jsonResponse({ ok: false, error: { _: 'error' as const, code: status, message } }, status);
}

// ---------------------------------------------------------------------------
// startProxy
// ---------------------------------------------------------------------------

export async function startProxy(options: ProxyOptions): Promise<ProxyHandle> {
  const port = options.port ?? DEFAULT_PORT;
  const filesDir = options.filesDirectory ?? DEFAULT_FILES_DIR;
  const dbDir = options.databaseDirectory ?? DEFAULT_DB_DIR;

  // --- 1. Configure and create TDLib client ---

  let client: tdl.Client;

  if (options.client) {
    client = options.client;
  } else {
    if (!options.apiId || !options.apiHash) {
      throw new Error('apiId and apiHash are required when client is not provided');
    }

    tdl.configure({ tdjson: options.tdjson ?? getTdjson() });

    client = tdl.createClient({
      apiId: options.apiId,
      apiHash: options.apiHash,
      databaseDirectory: dbDir,
      filesDirectory: filesDir,
    });
  }

  // --- 2. Update fan-out ---

  type UpdateListener = (update: Td.Update) => void;
  const updateListeners = new Set<UpdateListener>();

  function addUpdateListener(listener: UpdateListener): () => void {
    updateListeners.add(listener);
    return () => {
      updateListeners.delete(listener);
    };
  }

  client.on('update', (update: Td.Update) => {
    for (const listener of updateListeners) {
      try {
        listener(update);
      } catch {
        // Individual listener errors must not break the update pipeline
      }
    }
  });

  // --- 3. Auth state tracker ---

  let authState: Td.AuthorizationState | null = null;

  function getStateName(): string {
    if (!authState) return 'unknown';
    // "authorizationStateWaitPhoneNumber" -> "wait_phone_number"
    return authState._.replace('authorizationState', '')
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  }

  function buildAuthResponse(): Record<string, unknown> {
    if (!authState) {
      return { state: 'unknown', ready: false };
    }

    const base = { state: getStateName(), ready: authState._ === 'authorizationStateReady' };

    // Return raw TDLib state — CLI transforms as needed
    const { _: __, ...rest } = authState as Record<string, unknown>;
    return { ...base, ...rest };
  }

  function waitForStateChange(timeoutMs: number): Promise<void> {
    const initial = authState?._;
    return new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (authState?._ !== initial) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
        }
      }, 50);
      const timeout = setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, timeoutMs);
    });
  }

  addUpdateListener((update) => {
    if (update._ === 'updateAuthorizationState') {
      authState = update.authorization_state;
    }
  });

  // --- 4. Wait for actionable auth state ---

  if (!options.client) {
    await new Promise<void>((resolve) => {
      const handler = (update: Td.Update) => {
        if (update._ === 'updateAuthorizationState') {
          const s = update.authorization_state._;
          if (
            s === 'authorizationStateReady' ||
            s === 'authorizationStateWaitPhoneNumber' ||
            s === 'authorizationStateWaitCode' ||
            s === 'authorizationStateWaitPassword'
          ) {
            client.off('update', handler);
            resolve();
          }
        }
      };
      client.on('update', handler);
    });
  }

  // --- 5. SSE connection tracking ---

  let sseConnectionCount = 0;
  const startTime = Date.now();

  // --- 6. Media file serving ---

  function serveMediaFile(relPath: string): Response {
    // Try filesDir (media_cache) first, then dbDir (tdlib_db) for profile photos
    let filePath = path.resolve(path.join(filesDir, relPath));

    if (!filePath.startsWith(filesDir)) {
      return new Response('Forbidden', { status: 403, headers: CORS });
    }

    let file = Bun.file(filePath);
    if (!file.size) {
      // Fall back to dbDir (profile photos are stored under tdlib_db/)
      filePath = path.resolve(path.join(dbDir, relPath));
      if (!filePath.startsWith(dbDir)) {
        return new Response('Forbidden', { status: 403, headers: CORS });
      }
      file = Bun.file(filePath);
      if (!file.size) {
        return new Response('Not found', { status: 404, headers: CORS });
      }
    }

    const ext = path.extname(filePath).slice(1);
    const mime = mimeFromExtension(ext);

    return new Response(file, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...CORS,
      },
    });
  }

  // --- 6b. Open file in system ---

  async function handleOpenFile(req: Request): Promise<Response> {
    try {
      const body = (await req.json()) as { mediaUrl?: string };
      const mediaUrl = body.mediaUrl;
      if (!mediaUrl || typeof mediaUrl !== 'string') {
        return Response.json(
          { ok: false, error: 'Missing mediaUrl' },
          { status: 400, headers: CORS },
        );
      }
      const relPath = mediaUrl.replace(/^\/api\/media\//, '');
      // Resolve to absolute path — try filesDir first, then dbDir
      let filePath = path.resolve(path.join(filesDir, relPath));
      if (!filePath.startsWith(filesDir)) {
        return Response.json({ ok: false, error: 'Forbidden' }, { status: 403, headers: CORS });
      }
      let file = Bun.file(filePath);
      if (!file.size) {
        filePath = path.resolve(path.join(dbDir, relPath));
        if (!filePath.startsWith(dbDir)) {
          return Response.json({ ok: false, error: 'Forbidden' }, { status: 403, headers: CORS });
        }
        file = Bun.file(filePath);
        if (!file.size) {
          return Response.json(
            { ok: false, error: 'File not found' },
            { status: 404, headers: CORS },
          );
        }
      }
      Bun.spawn(['open', filePath]);
      return Response.json({ ok: true }, { headers: CORS });
    } catch {
      return Response.json(
        { ok: false, error: 'Failed to open file' },
        { status: 500, headers: CORS },
      );
    }
  }

  // --- 7. Route handlers ---

  async function handleInvoke(req: Request): Promise<Response> {
    let body: Parameters<Invoke>[0];
    try {
      const raw = await req.json();
      if (!raw._ || typeof raw._ !== 'string') throw new Error('missing _');
      body = raw as Parameters<Invoke>[0];
    } catch {
      return jsonResponse(
        { ok: false, error: 'Invalid request: body must be JSON with a "_" field' },
        400,
      );
    }

    try {
      const invoke = client.invoke.bind(client) as Invoke;
      const result = await invoke(body);
      return jsonResponse({ ok: true, data: result });
    } catch (e: unknown) {
      const err = e as { _?: string; code?: number; message?: string };
      if (err._ === 'error' && typeof err.code === 'number') {
        return jsonResponse({
          ok: false,
          error: { _: 'error', code: err.code, message: err.message ?? '' },
        });
      }
      return jsonResponse({ ok: false, error: (e as Error)?.message ?? String(e) }, 500);
    }
  }

  function handleUpdates(req: Request): Response {
    sseConnectionCount++;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const unsub = addUpdateListener((update: Td.Update) => {
          try {
            const line = `data: ${JSON.stringify(update, bigIntReplacer)}\n\n`;
            controller.enqueue(encoder.encode(line));
          } catch {
            // Stream may have been closed
          }
        });

        // Send heartbeat every 15s so clients can detect dead connections
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            clearInterval(heartbeat);
          }
        }, 15_000);

        req.signal.addEventListener('abort', () => {
          clearInterval(heartbeat);
          unsub();
          try {
            controller.close();
          } catch {
            // Already closed
          }
          sseConnectionCount = Math.max(0, sseConnectionCount - 1);
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...CORS,
      },
    });
  }

  function handleAuthState(): Response {
    return okResponse(buildAuthResponse());
  }

  async function handleAuthPhone(req: Request): Promise<Response> {
    if (authState?._ !== 'authorizationStateWaitPhoneNumber') {
      return errResponse(
        `Cannot submit phone in state "${getStateName()}". Expected: wait_phone_number`,
        'INVALID_ARGS',
      );
    }

    let body: { phone?: string };
    try {
      body = await req.json();
    } catch {
      return errResponse('Invalid JSON body', 'INVALID_ARGS');
    }

    if (!body.phone || typeof body.phone !== 'string') {
      return errResponse('Missing required field: "phone" (string)', 'INVALID_ARGS');
    }

    try {
      await client.invoke({
        _: 'setAuthenticationPhoneNumber',
        phone_number: body.phone,
        settings: {
          _: 'phoneNumberAuthenticationSettings',
          allow_flash_call: false,
          allow_missed_call: false,
          is_current_phone_number: false,
          has_unknown_phone_number: false,
          allow_sms_retriever_api: false,
          authentication_tokens: [],
        },
      });

      await waitForStateChange(3000);
      return okResponse(buildAuthResponse());
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e);
      console.error(`Auth phone error: ${msg}`);
      if (/PHONE_NUMBER_INVALID/i.test(msg)) {
        return errResponse('Invalid phone number format', 'INVALID_ARGS');
      }
      if (/PHONE_NUMBER_BANNED/i.test(msg)) {
        return errResponse('This phone number is banned', 'UNAUTHORIZED');
      }
      if (/FLOOD/i.test(msg)) {
        return errResponse(msg, 'FLOOD_WAIT', 429);
      }
      return errResponse(msg, 'UNKNOWN', 500);
    }
  }

  async function handleAuthCode(req: Request): Promise<Response> {
    if (authState?._ !== 'authorizationStateWaitCode') {
      return errResponse(
        `Cannot submit code in state "${getStateName()}". Expected: wait_code`,
        'INVALID_ARGS',
      );
    }

    let body: { code?: string };
    try {
      body = await req.json();
    } catch {
      return errResponse('Invalid JSON body', 'INVALID_ARGS');
    }

    if (!body.code || typeof body.code !== 'string') {
      return errResponse('Missing required field: "code" (string)', 'INVALID_ARGS');
    }

    try {
      await client.invoke({
        _: 'checkAuthenticationCode',
        code: body.code,
      });

      await waitForStateChange(3000);
      return okResponse(buildAuthResponse());
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e);
      console.error(`Auth code error: ${msg}`);
      if (/PHONE_CODE_INVALID/i.test(msg)) {
        return errResponse('Invalid verification code', 'INVALID_ARGS');
      }
      if (/PHONE_CODE_EXPIRED/i.test(msg)) {
        return errResponse('Verification code expired — request a new one', 'INVALID_ARGS');
      }
      if (/FLOOD/i.test(msg)) {
        return errResponse(msg, 'FLOOD_WAIT', 429);
      }
      return errResponse(msg, 'UNKNOWN', 500);
    }
  }

  async function handleAuthPassword(req: Request): Promise<Response> {
    if (authState?._ !== 'authorizationStateWaitPassword') {
      return errResponse(
        `Cannot submit password in state "${getStateName()}". Expected: wait_password`,
        'INVALID_ARGS',
      );
    }

    let body: { password?: string };
    try {
      body = await req.json();
    } catch {
      return errResponse('Invalid JSON body', 'INVALID_ARGS');
    }

    if (!body.password || typeof body.password !== 'string') {
      return errResponse('Missing required field: "password" (string)', 'INVALID_ARGS');
    }

    try {
      await client.invoke({
        _: 'checkAuthenticationPassword',
        password: body.password,
      });

      await waitForStateChange(3000);
      return okResponse(buildAuthResponse());
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e);
      console.error(`Auth password error: ${msg}`);
      if (/PASSWORD_HASH_INVALID/i.test(msg)) {
        return errResponse('Incorrect password', 'INVALID_ARGS');
      }
      if (/FLOOD/i.test(msg)) {
        return errResponse(msg, 'FLOOD_WAIT', 429);
      }
      return errResponse(msg, 'UNKNOWN', 500);
    }
  }

  async function handleAuthResend(): Promise<Response> {
    if (authState?._ !== 'authorizationStateWaitCode') {
      return errResponse(
        `Cannot resend code in state "${getStateName()}". Expected: wait_code`,
        'INVALID_ARGS',
      );
    }

    try {
      await client.invoke({ _: 'resendAuthenticationCode' });
      await waitForStateChange(3000);
      return okResponse(buildAuthResponse());
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e);
      console.error(`Auth resend error: ${msg}`);
      if (/FLOOD/i.test(msg)) {
        return errResponse(msg, 'FLOOD_WAIT', 429);
      }
      return errResponse(msg, 'UNKNOWN', 500);
    }
  }

  async function handleAuthLogout(): Promise<Response> {
    try {
      await client.invoke({ _: 'logOut' });
      return okResponse({ logged_out: true });
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e);
      console.error(`Auth logout error: ${msg}`);
      return errResponse(msg, 'UNKNOWN', 500);
    }
  }

  function handleHealth(): Response {
    return jsonResponse({
      ok: true,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      pid: process.pid,
      connections: sseConnectionCount,
    });
  }

  // --- 8. Start HTTP server ---

  const httpServer = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
      }

      if (url.pathname === '/api/tg/invoke' && req.method === 'POST') {
        return handleInvoke(req);
      }
      if (url.pathname === '/api/tg/updates' && req.method === 'GET') {
        return handleUpdates(req);
      }
      if (url.pathname === '/api/tg/auth/state' && req.method === 'GET') {
        return handleAuthState();
      }
      if (url.pathname === '/api/tg/auth/phone' && req.method === 'POST') {
        return handleAuthPhone(req);
      }
      if (url.pathname === '/api/tg/auth/code' && req.method === 'POST') {
        return handleAuthCode(req);
      }
      if (url.pathname === '/api/tg/auth/password' && req.method === 'POST') {
        return handleAuthPassword(req);
      }
      if (url.pathname === '/api/tg/auth/resend' && req.method === 'POST') {
        return handleAuthResend();
      }
      if (url.pathname === '/api/tg/auth/logout' && req.method === 'POST') {
        return handleAuthLogout();
      }
      if (url.pathname.startsWith('/api/media/') && req.method === 'GET') {
        const relPath = url.pathname.replace(/^\/api\/media\//, '');
        return serveMediaFile(relPath);
      }
      if (url.pathname === '/api/open' && req.method === 'POST') {
        return handleOpenFile(req);
      }
      if (url.pathname === '/health' && req.method === 'GET') {
        return handleHealth();
      }

      return new Response('Not found', { status: 404, headers: CORS });
    },
  });

  // --- 9. Return handle ---

  const actualPort = httpServer.port ?? port;

  return {
    port: actualPort,
    url: `http://localhost:${actualPort}`,
    client,
    async stop() {
      httpServer.stop();
      await client.close();
    },
  };
}
