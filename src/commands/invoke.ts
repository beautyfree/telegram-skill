/**
 * `telegram-agent invoke <Namespace.Class> --params '{...}'` — escape
 * hatch for any MTProto method we don't surface as a first-class
 * command. Auto-hydrates entity-like params (`peer`, `channel`, `user`,
 * `bot`, `chat`, `fromPeer`, `toPeer`).
 */
import type { Cmd } from './_shared.js';
import { withClient, need, print, fail, flagStr } from './_shared.js';
import { resolveApiClass, hydrateApiParams } from '../helpers.js';

export const invoke: Cmd = async (args, flags) => {
  const className = need(args, 0, 'Namespace.Class');
  const raw = flagStr(flags, 'params') ?? '{}';
  let params: any;
  try {
    params = JSON.parse(raw);
  } catch (err) {
    fail(`Invalid --params JSON: ${(err as Error).message}`);
  }
  await withClient(flags, async (client) => {
    const Ctor: any = resolveApiClass(className);
    const hydrated = await hydrateApiParams(client, params);
    const inst = new Ctor(hydrated);
    const result = await client.invoke(inst);
    print(result);
  });
};
