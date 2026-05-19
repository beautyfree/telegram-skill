import type { error } from 'tdlib-types';

/** Daemon response envelope. */
export type DaemonResponse<T> = { ok: true; data: T } | { ok: false; error: error };

/** Auth state returned by GET /api/tg/auth/state. Raw TDLib fields passed through. */
export interface AuthState {
  state: string;
  ready: boolean;
  [key: string]: unknown;
}

/** Error thrown by TelegramClient when a TDLib call fails. */
export class TelegramError extends Error {
  readonly code: number;

  constructor(err: error) {
    super(err.message);
    this.name = 'TelegramError';
    this.code = err.code;
  }
}
