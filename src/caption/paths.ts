/**
 * Shared constants + path helpers for the caption daemon. Kept separate
 * from `daemon.ts` so the client (caption.ts) can read paths without
 * pulling in the model-loading code path.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export const MODEL_ID = 'onnx-community/Florence-2-base';
export const MODEL_DTYPE = 'q4';
export const CAPTION_DEFAULT_PORT = 7313;
export const CAPTION_IDLE_MS = 5 * 60 * 1000;

export interface CaptionPaths {
  baseDir: string;
  modelsDir: string;
  pidFile: string;
  portFile: string;
  logFile: string;
}

export function captionPaths(): CaptionPaths {
  const baseDir = process.env.TELEGRAM_AGENT_HOME ?? join(homedir(), '.telegram-agent');
  return {
    baseDir,
    modelsDir: join(baseDir, 'models'),
    pidFile: join(baseDir, 'caption.pid'),
    portFile: join(baseDir, 'caption.port'),
    logFile: join(baseDir, 'caption.log'),
  };
}
