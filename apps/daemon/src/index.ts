/**
 * Daemon entry point — thin process wrapper around @tg/protocol/proxy.
 *
 * Responsibilities:
 *   1. PID/port file management
 *   2. Load credentials
 *   3. Start proxy via @tg/protocol/proxy
 *   4. Idle timeout (10 min, deferred if SSE connections active)
 *   5. Signal handlers (SIGINT, SIGTERM, SIGHUP → graceful shutdown)
 *   6. Crash handlers (uncaughtException, unhandledRejection)
 *   7. Log lifecycle events
 */

import { mkdirSync } from 'node:fs';
import { startProxy } from '@tg/protocol/proxy';
import { APP_DIR, DEFAULT_PORT, IDLE_TIMEOUT_MS, loadCredentials } from './config';
import { log } from './logger';
import { cleanStalePid, cleanupFiles, writePid, writePort } from './pid';

async function startDaemon(): Promise<void> {
  mkdirSync(APP_DIR, { recursive: true });
  cleanStalePid();
  writePid();

  const credentials = loadCredentials();
  log(`API credentials loaded (ID: ${credentials.apiId})`);

  const port = Number(process.env.TG_DAEMON_PORT) || DEFAULT_PORT;

  log('Starting TDLib proxy...');
  const proxy = await startProxy({
    apiId: credentials.apiId,
    apiHash: credentials.apiHash,
    port,
  });

  writePort(proxy.port);
  log(`Daemon ready (PID ${process.pid}, port ${proxy.port})`);

  // Try to log username
  try {
    // biome-ignore lint/suspicious/noExplicitAny: Invoke type workaround
    const me = await proxy.client.invoke({ _: 'getMe' } as any);
    const user = me as {
      usernames?: { editable_username?: string; active_usernames?: string[] };
      id: number;
    };
    const username =
      user.usernames?.editable_username ?? user.usernames?.active_usernames?.[0] ?? String(user.id);
    log(`Logged in as: ${username}`);
  } catch {
    log('Not yet authorized (waiting for auth flow via HTTP)');
  }

  // --- Idle timeout ---
  // The proxy doesn't manage idle timeout — that's the daemon's job.
  // We poll /health to check for active SSE connections before shutting down.
  let idleTimer: ReturnType<typeof setTimeout>;

  function resetIdleTimer(): void {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
      try {
        const res = await fetch(`http://localhost:${proxy.port}/health`);
        const health = (await res.json()) as { connections?: number };
        if ((health.connections ?? 0) > 0) {
          log(`Idle timer fired but ${health.connections} connection(s) active, deferring`);
          resetIdleTimer();
          return;
        }
      } catch {
        // If health check fails, proceed with shutdown
      }
      log('Idle timeout reached, shutting down');
      shutdown();
    }, IDLE_TIMEOUT_MS);
  }
  resetIdleTimer();

  // Reset idle timer when proxy gets requests (poll health every 30s)
  const healthPoll = setInterval(async () => {
    try {
      const res = await fetch(`http://localhost:${proxy.port}/health`);
      if (res.ok) resetIdleTimer();
    } catch {
      // Ignore
    }
  }, 30_000);

  // --- Graceful shutdown ---
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log('Shutting down...');
    clearTimeout(idleTimer);
    clearInterval(healthPoll);

    try {
      await proxy.stop();
    } catch {
      // Best effort
    }

    cleanupFiles();
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
  process.on('SIGHUP', () => shutdown());

  process.on('uncaughtException', (err) => {
    log(`Uncaught exception: ${err.message}`);
    cleanupFiles();
    process.exit(1);
  });

  process.on('unhandledRejection', (err: unknown) => {
    log(`Unhandled rejection: ${(err as Error)?.message ?? err}`);
    cleanupFiles();
    process.exit(1);
  });

  process.on('exit', cleanupFiles);
}

startDaemon().catch((e) => {
  log(`Fatal: ${(e as Error).message}`);
  cleanupFiles();
  process.exit(1);
});
