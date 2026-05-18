/**
 * `flattenMessage` — agent-friendly serialization.
 *
 * Combines `serializeMessage` (raw fields) with addSenderNames output to
 * produce a compact JSON shape:
 *
 *   {
 *     id: 12345,
 *     date: 1716090123,
 *     dateRel: "14:32",                 // smart relative
 *     from: { id, type, name, username? },
 *     peer: { id, type, name, username? },
 *     text: "...",
 *     out: true,                        // present only when sent by you
 *     replyTo: 12344,                   // present only when message is a reply
 *     albumId: "1234567890",            // present only when in a grouped album
 *     downloadPath: "...",              // present only when media was downloaded
 *     mediaType: "MessageMediaPhoto",   // present only when media exists
 *     views, forwards, transcription, …
 *   }
 *
 * Keys with undefined / empty values are dropped — saves tokens.
 */

function compact<T extends Record<string, unknown>>(obj: T): T {
  for (const k in obj) {
    const v = obj[k];
    if (v === undefined || v === null) delete obj[k];
    else if (typeof v === 'string' && v.length === 0) delete obj[k];
    else if (Array.isArray(v) && v.length === 0) delete obj[k];
  }
  return obj;
}

/**
 * Smart relative date — mirrors avemeva.
 *
 * - same day: `HH:MM` (UTC for predictability across CI)
 * - within 24h: `Yesterday HH:MM`
 * - within 7 days: weekday short name + HH:MM
 * - within current year: `Mon D HH:MM`
 * - older: `YYYY-MM-DD`
 *
 * Input: unix seconds. Falls back to ISO string for non-finite input.
 */
export function smartDate(unixSec: number | undefined, nowMs: number = Date.now()): string | undefined {
  if (!Number.isFinite(unixSec) || !unixSec) return undefined;
  const d = new Date((unixSec as number) * 1000);
  const now = new Date(nowMs);

  const sameDay =
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate();
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  const ageMs = nowMs - d.getTime();
  const oneDay = 86_400_000;

  function hhmm(x: Date): string {
    const h = String(x.getUTCHours()).padStart(2, '0');
    const m = String(x.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  function ymd(x: Date): string {
    const y = x.getUTCFullYear();
    const m = String(x.getUTCMonth() + 1).padStart(2, '0');
    const da = String(x.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  }

  const weekdayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    d.getUTCMonth()
  ];

  if (sameDay) return hhmm(d);
  if (ageMs < 2 * oneDay) return `Yesterday ${hhmm(d)}`;
  if (ageMs < 7 * oneDay) return `${weekdayShort} ${hhmm(d)}`;
  if (sameYear) return `${monthShort} ${d.getUTCDate()} ${hhmm(d)}`;
  return ymd(d);
}

interface Identity {
  id: string;
  type: 'user' | 'chat' | 'channel';
  name?: string;
  username?: string;
}

export interface FlatButton {
  /** Flat 1-based index across the keyboard, matches `action click <n>`. */
  index: number;
  /** Row index (0-based) for callers that want the original layout. */
  row: number;
  /** Column index within the row. */
  col: number;
  label: string;
  /** Button type from gram.js — `KeyboardButtonCallback`, `…Url`, `…WebApp`, … */
  type?: string;
  /** Present for URL / web-app / login-url buttons. */
  url?: string;
  /** Present for callback buttons — base64 of the callback payload. */
  data?: string;
}

/**
 * Convert a gram.js `replyMarkup` (ReplyInlineMarkup / KeyboardButtonRow)
 * into a flat `FlatButton[]`. Numbers buttons left-to-right, top-to-bottom
 * starting at 1 — matches `telegram-agent action click <n>`.
 *
 * Returns undefined when there's no keyboard. We only flatten inline
 * keyboards (`ReplyInlineMarkup`); persistent reply keyboards aren't
 * actionable from the CLI.
 */
function flattenButtons(replyMarkup: any): FlatButton[] | undefined {
  if (!replyMarkup) return undefined;
  if (replyMarkup.className !== 'ReplyInlineMarkup') return undefined;
  const rows = replyMarkup.rows ?? [];
  const out: FlatButton[] = [];
  let index = 1;
  for (let r = 0; r < rows.length; r++) {
    const buttons = rows[r]?.buttons ?? [];
    for (let c = 0; c < buttons.length; c++) {
      const b = buttons[c];
      const item: FlatButton = {
        index,
        row: r,
        col: c,
        label: b.text ?? '',
        type: b.className,
      };
      if (b.url) item.url = b.url;
      if (b.data) {
        // gram.js gives data as a Buffer for callback buttons.
        try {
          item.data = Buffer.isBuffer(b.data) ? b.data.toString('base64') : String(b.data);
        } catch {
          /* swallow */
        }
      }
      out.push(item);
      index++;
    }
  }
  return out.length ? out : undefined;
}

export interface FlatMessage {
  id: number;
  date: number;
  dateRel?: string;
  from?: Identity;
  peer?: Identity;
  text?: string;
  out?: true;
  replyTo?: number;
  albumId?: string;
  downloadPath?: string;
  mediaType?: string;
  buttons?: FlatButton[];
  links?: { url: string; title?: string; description?: string }[];
  views?: number;
  forwards?: number;
  transcription?: { text?: string; pending?: boolean; error?: string };
  [k: string]: unknown;
}

/**
 * Turn a gram.js Message (potentially mutated by addSenderNames /
 * autoDownload*) into a `FlatMessage`. Drops empty fields and adds
 * `dateRel`.
 *
 * If the underlying message was already serialized (you passed the
 * output of `serializeMessage`), this function is still idempotent —
 * it picks up the same fields by name.
 */
export function flattenMessage(m: any, nowMs: number = Date.now()): FlatMessage {
  const out: FlatMessage = {
    id: m.id,
    date: m.date,
    dateRel: smartDate(m.date, nowMs),
    from: m.from,
    peer: m.peer,
    text: m.message ?? m.text,
    replyTo: m.replyTo?.replyToMsgId ?? m.replyTo,
    albumId: m.groupedId?.toString?.() ?? m.albumId,
    downloadPath: m.downloadPath,
    mediaType: m.media?.className ?? m.mediaType,
    buttons: flattenButtons(m.replyMarkup),
    links: m.links,
    views: m.views,
    forwards: m.forwards,
    transcription: m.transcription,
  };
  if (m.out === true) out.out = true;
  return compact(out);
}

export function flattenMessages(messages: any[], nowMs: number = Date.now()): FlatMessage[] {
  return messages.map((m) => flattenMessage(m, nowMs));
}

export { flattenButtons };
