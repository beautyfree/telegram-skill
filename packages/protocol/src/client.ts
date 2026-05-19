import type { Invoke, Update } from 'tdlib-types';
import { type AuthState, type DaemonResponse, TelegramError } from './types';

export interface TelegramClientOptions {
  /** Base URL of the proxy, e.g. "http://localhost:7312" */
  baseUrl: string;
}

type UpdateHandler = (update: Update) => void;

export class TelegramClient {
  private baseUrl: string;
  private handlers = new Set<UpdateHandler>();
  private abortController: AbortController | null = null;
  private sseConnected = false;
  private sseHasConnectedBefore = false;
  private reconnectHandlers = new Set<() => void>();

  /** Optional signal to abort all non-SSE requests. */
  signal: AbortSignal | undefined;

  constructor(opts: TelegramClientOptions | string) {
    this.baseUrl = typeof opts === 'string' ? opts : opts.baseUrl;
    // Strip trailing slash
    if (this.baseUrl.endsWith('/')) {
      this.baseUrl = this.baseUrl.slice(0, -1);
    }
  }

  /**
   * Invoke a TDLib method. Fully typed via tdlib-types Invoke signature.
   *
   *   const me = await client.invoke({ _: 'getMe' })
   *   // me is typed as `user`
   */
  invoke = (async (params: Record<string, unknown>) => {
    const res = await fetch(`${this.baseUrl}/api/tg/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: this.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as DaemonResponse<unknown>;
    if (!json.ok) {
      throw new TelegramError(json.error);
    }
    return json.data;
  }) as unknown as Invoke;

  /** Subscribe to raw TDLib updates via SSE. Starts the SSE connection on first call. */
  on(event: 'update', handler: UpdateHandler): void {
    if (event !== 'update') return;
    this.handlers.add(handler);
    if (!this.sseConnected) {
      this.connectSSE();
    }
  }

  /** Unsubscribe from updates. Closes SSE if no handlers remain. */
  off(event: 'update', handler: UpdateHandler): void {
    if (event !== 'update') return;
    this.handlers.delete(handler);
    if (this.handlers.size === 0) {
      this.disconnectSSE();
    }
  }

  // --- Auth helpers ---

  async getAuthState(): Promise<AuthState> {
    const res = await fetch(`${this.baseUrl}/api/tg/auth/state`, { signal: this.signal });
    const json = (await res.json()) as DaemonResponse<AuthState>;
    if (!json.ok) throw new TelegramError(json.error);
    return json.data;
  }

  async submitPhone(phone: string): Promise<AuthState> {
    const res = await fetch(`${this.baseUrl}/api/tg/auth/phone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
      signal: this.signal,
    });
    const json = (await res.json()) as DaemonResponse<AuthState>;
    if (!json.ok) throw new TelegramError(json.error);
    return json.data;
  }

  async submitCode(code: string): Promise<AuthState> {
    const res = await fetch(`${this.baseUrl}/api/tg/auth/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: this.signal,
    });
    const json = (await res.json()) as DaemonResponse<AuthState>;
    if (!json.ok) throw new TelegramError(json.error);
    return json.data;
  }

  async resendCode(): Promise<AuthState> {
    const res = await fetch(`${this.baseUrl}/api/tg/auth/resend`, {
      method: 'POST',
      signal: this.signal,
    });
    const json = (await res.json()) as DaemonResponse<AuthState>;
    if (!json.ok) throw new TelegramError(json.error);
    return json.data;
  }

  async submitPassword(password: string): Promise<AuthState> {
    const res = await fetch(`${this.baseUrl}/api/tg/auth/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      signal: this.signal,
    });
    const json = (await res.json()) as DaemonResponse<AuthState>;
    if (!json.ok) throw new TelegramError(json.error);
    return json.data;
  }

  /** Register a callback that fires when SSE reconnects (not on initial connect). */
  onReconnect(handler: () => void): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  /** Close SSE connection and clean up. */
  close(): void {
    this.disconnectSSE();
    this.handlers.clear();
    this.reconnectHandlers.clear();
  }

  // --- SSE internals ---

  private connectSSE(): void {
    this.sseConnected = true;
    this.abortController = new AbortController();

    const connect = async () => {
      let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

      const resetHeartbeat = () => {
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        // If no data (including pings) for 30s, consider connection dead
        heartbeatTimer = setTimeout(() => {
          this.abortController?.abort();
          this.abortController = new AbortController();
          if (this.sseConnected && this.handlers.size > 0) {
            setTimeout(() => connect(), 1000);
          }
        }, 30_000);
      };

      try {
        const res = await fetch(`${this.baseUrl}/api/tg/updates`, {
          signal: this.abortController?.signal,
        });

        if (!res.ok || !res.body) {
          // Daemon not ready — retry instead of giving up
          if (this.sseConnected && this.handlers.size > 0) {
            setTimeout(() => connect(), 2000);
          }
          return;
        }

        // Fire reconnect callbacks (skip the very first connection)
        if (this.sseHasConnectedBefore) {
          for (const handler of this.reconnectHandlers) {
            try {
              handler();
            } catch {}
          }
        }
        this.sseHasConnectedBefore = true;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        resetHeartbeat();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          resetHeartbeat();

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const update = JSON.parse(line.slice(6)) as Update;
              for (const handler of this.handlers) {
                try {
                  handler(update);
                } catch {
                  // Don't break iteration on handler errors
                }
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }

        // Stream ended cleanly — reconnect
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        if (this.sseConnected && this.handlers.size > 0) {
          setTimeout(() => connect(), 1000);
        }
      } catch (e: unknown) {
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        if ((e as Error)?.name === 'AbortError') {
          // AbortError from heartbeat timeout triggers reconnect above
          return;
        }
        // Reconnect after 1 second on unexpected disconnect
        if (this.sseConnected && this.handlers.size > 0) {
          setTimeout(() => connect(), 1000);
        }
      }
    };

    connect();
  }

  private disconnectSSE(): void {
    this.sseConnected = false;
    this.abortController?.abort();
    this.abortController = null;
  }
}
