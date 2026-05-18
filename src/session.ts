/**
 * Absolute-path-safe session store for gram.js.
 *
 * gram.js's bundled `StoreSession` is hardcoded to prefix the session name
 * with `"./"` before instantiating `node-localstorage`. That makes the
 * session path cwd-relative no matter what we pass in — invoking
 * `telegram-agent` from any cwd other than `~` produced a stray
 * `<cwd>/Users/devall/.telegram-agent/sessions/...` tree with
 * URL-encoded filenames.
 *
 * We subclass `MemorySession` directly and persist to an absolute
 * directory via `node-localstorage`. Keys are written as plain filenames
 * (`authKey`, `dcId`, `port`, `serverAddress`, `<entityId>`), so the
 * on-disk layout under `~/.telegram-agent/sessions/<accountId>/` is
 * human-readable and stable across cwds.
 */
import { resolve, join } from 'path';
import { chmodSync } from 'fs';
import { MemorySession } from 'telegram/sessions/index.js';
import { AuthKey } from 'telegram/crypto/AuthKey.js';
// node-localstorage has no @types package.
// @ts-ignore
import { LocalStorage } from 'node-localstorage';

export class FileSession extends MemorySession {
  private readonly store: any;
  private readonly dir: string;

  constructor(absoluteDir: string) {
    super();
    // `resolve` collapses any `.` / `..` and guarantees an absolute path.
    // node-localstorage's constructor calls `path.resolve(_location)`
    // internally, so a fully-qualified path here keeps the storage out
    // of the current working directory.
    this.dir = resolve(absoluteDir);
    this.store = new LocalStorage(this.dir);
    // Lock perms on the dir; FileSession files live inside.
    try { chmodSync(this.dir, 0o700); } catch {}
  }

  private read(key: string): unknown {
    const raw = this.store.getItem(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  private write(key: string, value: unknown): void {
    this.store.setItem(key, JSON.stringify(value));
    // node-localstorage URL-encodes the key into a filename. Mirror the
    // encoding here so chmod hits the right file. Failure is non-fatal —
    // the umask default still applies.
    try { chmodSync(join(this.dir, encodeURIComponent(key)), 0o600); } catch {}
  }

  async load(): Promise<void> {
    const persisted = this.read('authKey');
    if (persisted && typeof persisted === 'object') {
      const key = new AuthKey();
      const buf =
        'data' in (persisted as any)
          ? Buffer.from((persisted as any).data)
          : Buffer.from(persisted as any);
      await key.setKey(buf);
      // Direct field assignment so we don't re-trigger the `set authKey`
      // accessor (which would round-trip the value back to disk pointlessly).
      // _authKey is a protected MemorySession field — accessed by name here
      // because TS marks it private; the runtime behavior is well-defined.
      (this as any)._authKey = key;
    }
    const dcId = this.read('dcId') as number | null;
    const port = this.read('port') as number | null;
    const serverAddress = this.read('serverAddress') as string | null;
    if (dcId != null && serverAddress != null && port != null) {
      // Re-use the public MemorySession.setDC API — no private fields needed.
      // Skip the FileSession override by invoking the base implementation,
      // so we don't re-write the same values to disk during load.
      MemorySession.prototype.setDC.call(this, dcId, serverAddress, port);
    }
  }

  setDC(dcId: number, serverAddress: string, port: number): void {
    this.write('dcId', dcId);
    this.write('port', port);
    this.write('serverAddress', serverAddress);
    super.setDC(dcId, serverAddress, port);
  }

  // @ts-ignore — MemorySession declares authKey as a property; we replace
  // it with an accessor pair that mirrors values into the file store.
  set authKey(value: AuthKey | undefined) {
    (this as any)._authKey = value;
    this.write('authKey', value?.getKey());
  }
  get authKey(): AuthKey | undefined {
    return (this as any)._authKey;
  }

  processEntities(tlo: unknown): void {
    const rows = (this as any)._entitiesToRows(tlo);
    if (!rows) return;
    for (const row of rows as any[][]) {
      row.push(new Date().getTime().toString());
      this.write(String(row[0]), row);
    }
  }

  getEntityRowsById(id: any, _exact = true): any {
    const row = this.read(String(id));
    return row == null ? undefined : (row as any[]);
  }
}
