/**
 * URL extraction + link preview enrichment for messages.
 *
 * For each message text, pull the first URL we find (entity-based first,
 * regex fallback), then call `messages.GetWebPagePreview` to get the
 * `{ url, title, description }` triple. Attaches to `m.links` so
 * `flattenMessage` surfaces it in the output.
 *
 * Failures are silent. Cache is per-call by default — pass a shared
 * `LinkCache` from the daemon if you want cross-request reuse.
 */
import { Api } from 'telegram';

type Client = any;
type Message = any;

const URL_RE = /https?:\/\/[^\s<>"')\]]+/;

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
}

export type LinkCache = Map<string, LinkPreview | null>;

export function makeLinkCache(): LinkCache {
  return new Map();
}

/**
 * Pull the first URL from a message — preferring entity offsets if the
 * server sent them, falling back to regex on the plain text.
 */
function firstUrl(m: Message): string | undefined {
  const entities = m.entities ?? [];
  for (const e of entities) {
    if (e.className === 'MessageEntityTextUrl' && e.url) return e.url;
    if (e.className === 'MessageEntityUrl') {
      const slice = m.message?.slice?.(e.offset, e.offset + e.length);
      if (slice) return slice;
    }
  }
  return m.message ? m.message.match(URL_RE)?.[0] : undefined;
}

async function fetchPreview(client: Client, url: string): Promise<LinkPreview | null> {
  const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const res: any = await client.invoke(new Api.messages.GetWebPagePreview({ message: fullUrl }));
    // MessageMediaWebPage wraps a WebPage; a WebPageEmpty means no preview.
    const wp = res?.webpage ?? res;
    const page = wp?.webpage ?? wp;
    if (!page || page.className === 'WebPageEmpty') return null;
    const out: LinkPreview = { url: page.url ?? fullUrl };
    if (page.title) out.title = page.title;
    if (page.description) out.description = page.description;
    return out;
  } catch {
    return null;
  }
}

/**
 * Walk messages, attach `.links: [LinkPreview]` for the first URL in each.
 * In-flight fetches dedupe by URL via the cache. Bounded concurrency
 * (8 at a time) — link previews go through Telegram, not direct fetch,
 * so they hit the same rate-limit budget as everything else.
 */
export async function attachLinkPreviews(
  client: Client,
  messages: Message[],
  cache: LinkCache = makeLinkCache(),
): Promise<void> {
  const pending = new Map<string, Promise<LinkPreview | null>>();
  const tasks: Promise<void>[] = [];

  for (const m of messages) {
    const url = firstUrl(m);
    if (!url) continue;
    if (cache.has(url)) {
      const hit = cache.get(url);
      if (hit) m.links = [hit];
      continue;
    }
    let p = pending.get(url);
    if (!p) {
      p = fetchPreview(client, url).then((preview) => {
        cache.set(url, preview);
        return preview;
      });
      pending.set(url, p);
    }
    tasks.push(
      p.then((preview) => {
        if (preview) m.links = [preview];
      }),
    );
  }

  // Cap concurrency by chunking the awaits.
  const CHUNK = 8;
  for (let i = 0; i < tasks.length; i += CHUNK) {
    await Promise.all(tasks.slice(i, i + CHUNK));
  }
}
