/**
 * Wire protocol between the CLI process and the long-running daemon.
 *
 * Newline-delimited JSON over a Unix socket. Each request is one line:
 *   { id: string, method: string, args: string[], flags: object, env?: object }
 *
 * Each response is one line:
 *   { id: string, ok: true,  result: any }
 *   { id: string, ok: false, error: string }
 *
 * Streaming commands (like `listen`) may send multiple `event` frames
 * before the final `result` (or are torn down by the CLI hanging up).
 *
 * Keeping the protocol this dumb means we never need a code-gen step —
 * the daemon just dispatches into the same command table the CLI uses.
 */
export interface Request {
  id: string;
  method: string;
  args: string[];
  flags: Record<string, string | boolean>;
  env?: Record<string, string | undefined>;
}

export interface ResponseOk {
  id: string;
  ok: true;
  result?: any;
  /** Stdout chunk emitted by the command (one JSON object per line in the original CLI). */
  out?: string;
  /** Set on the final frame so the CLI knows to disconnect. */
  done?: boolean;
}

export interface ResponseErr {
  id: string;
  ok: false;
  error: string;
  done: true;
}

export type Response = ResponseOk | ResponseErr;

/** Idle window before the daemon exits itself. 10 min mirrors avemeva. */
export const DAEMON_IDLE_MS = 10 * 60 * 1000;
