import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'tg-agent-caption-'));
  vi.resetModules();
});

afterEach(() => {
  delete process.env.TELEGRAM_AGENT_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('captionPaths', () => {
  it('honors TELEGRAM_AGENT_HOME env override', async () => {
    process.env.TELEGRAM_AGENT_HOME = tmpHome;
    const { captionPaths, MODEL_ID, MODEL_DTYPE, CAPTION_DEFAULT_PORT } = await import('../src/caption/paths.js');
    const p = captionPaths();
    expect(p.baseDir).toBe(tmpHome);
    expect(p.modelsDir).toBe(join(tmpHome, 'models'));
    expect(p.pidFile).toBe(join(tmpHome, 'caption.pid'));
    expect(p.portFile).toBe(join(tmpHome, 'caption.port'));
    expect(p.logFile).toBe(join(tmpHome, 'caption.log'));
    expect(MODEL_ID).toBe('onnx-community/Florence-2-base');
    expect(MODEL_DTYPE).toBe('q4');
    expect(CAPTION_DEFAULT_PORT).toBe(7313);
  });

  it('defaults to ~/.telegram-agent/', async () => {
    delete process.env.TELEGRAM_AGENT_HOME;
    const { captionPaths } = await import('../src/caption/paths.js');
    const p = captionPaths();
    expect(p.baseDir).toBe(join(homedir(), '.telegram-agent'));
  });
});

describe('caption client (offline)', () => {
  it('reports daemon not running when no pid file exists', async () => {
    process.env.TELEGRAM_AGENT_HOME = tmpHome;
    const { isCaptionDaemonRunning } = await import('../src/caption/client.js');
    expect(isCaptionDaemonRunning()).toBe(false);
  });
});
