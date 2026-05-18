import { describe, it, expect } from 'vitest';
import { flattenMessage, flattenMessages, smartDate, flattenButtons } from '../src/enrich/flatten.js';

describe('smartDate', () => {
  const NOW = Date.UTC(2026, 4, 19, 14, 0, 0); // 2026-05-19 14:00 UTC

  it('returns HH:MM for same UTC day', () => {
    const ts = Math.floor(Date.UTC(2026, 4, 19, 9, 30, 0) / 1000);
    expect(smartDate(ts, NOW)).toBe('09:30');
  });

  it('returns "Yesterday HH:MM" within 24-48h window', () => {
    const ts = Math.floor(Date.UTC(2026, 4, 18, 13, 0, 0) / 1000); // 25h ago
    expect(smartDate(ts, NOW)).toBe('Yesterday 13:00');
  });

  it('returns weekday short within last 7 days', () => {
    const ts = Math.floor(Date.UTC(2026, 4, 15, 10, 15, 0) / 1000); // ~4d ago, Fri
    expect(smartDate(ts, NOW)).toBe('Fri 10:15');
  });

  it('returns "Mon D HH:MM" within same year', () => {
    const ts = Math.floor(Date.UTC(2026, 2, 1, 7, 0, 0) / 1000); // Mar 1
    expect(smartDate(ts, NOW)).toBe('Mar 1 07:00');
  });

  it('returns ISO date for older than year', () => {
    const ts = Math.floor(Date.UTC(2024, 0, 5, 8, 0, 0) / 1000);
    expect(smartDate(ts, NOW)).toBe('2024-01-05');
  });

  it('returns undefined for falsy / invalid input', () => {
    expect(smartDate(undefined, NOW)).toBeUndefined();
    expect(smartDate(0, NOW)).toBeUndefined();
    expect(smartDate(NaN, NOW)).toBeUndefined();
  });
});

describe('flattenMessage', () => {
  const NOW = Date.UTC(2026, 4, 19, 14, 0, 0);

  it('drops empty fields, includes dateRel', () => {
    const raw = {
      id: 42,
      date: Math.floor(Date.UTC(2026, 4, 19, 13, 0, 0) / 1000),
      message: 'hi',
      from: { id: '1', type: 'user' as const, name: 'Alice' },
      peer: { id: '2', type: 'user' as const, name: 'Bob' },
      out: false,
    };
    const flat = flattenMessage(raw, NOW);
    expect(flat).toEqual({
      id: 42,
      date: raw.date,
      dateRel: '13:00',
      from: { id: '1', type: 'user', name: 'Alice' },
      peer: { id: '2', type: 'user', name: 'Bob' },
      text: 'hi',
    });
    expect('out' in flat).toBe(false); // out:false dropped
  });

  it('keeps out:true', () => {
    const raw = { id: 1, date: NOW / 1000, message: 'x', out: true };
    expect(flattenMessage(raw, NOW).out).toBe(true);
  });

  it('preserves albumId, replyTo, downloadPath, transcription', () => {
    const raw = {
      id: 5,
      date: NOW / 1000,
      message: 'caption',
      groupedId: BigInt('1234567890'),
      replyTo: { replyToMsgId: 4 },
      downloadPath: '/tmp/x',
      transcription: { text: 'hello' },
      media: { className: 'MessageMediaPhoto' },
    };
    const flat = flattenMessage(raw, NOW);
    expect(flat.albumId).toBe('1234567890');
    expect(flat.replyTo).toBe(4);
    expect(flat.downloadPath).toBe('/tmp/x');
    expect(flat.transcription).toEqual({ text: 'hello' });
    expect(flat.mediaType).toBe('MessageMediaPhoto');
  });

  it('flattens inline keyboard into buttons[]', () => {
    const raw = {
      id: 9,
      date: NOW / 1000,
      message: 'choose',
      replyMarkup: {
        className: 'ReplyInlineMarkup',
        rows: [
          {
            buttons: [
              { className: 'KeyboardButtonCallback', text: 'Yes', data: Buffer.from('ok') },
              { className: 'KeyboardButtonUrl', text: 'Docs', url: 'https://example.com' },
            ],
          },
          { buttons: [{ className: 'KeyboardButtonCallback', text: 'Cancel', data: Buffer.from('no') }] },
        ],
      },
    };
    const flat = flattenMessage(raw, NOW);
    expect(flat.buttons).toEqual([
      { index: 1, row: 0, col: 0, label: 'Yes', type: 'KeyboardButtonCallback', data: Buffer.from('ok').toString('base64') },
      { index: 2, row: 0, col: 1, label: 'Docs', type: 'KeyboardButtonUrl', url: 'https://example.com' },
      { index: 3, row: 1, col: 0, label: 'Cancel', type: 'KeyboardButtonCallback', data: Buffer.from('no').toString('base64') },
    ]);
  });

  it('omits buttons when no keyboard', () => {
    expect(flattenMessage({ id: 1, date: NOW / 1000, message: 'plain' }, NOW).buttons).toBeUndefined();
  });

  it('flattenButtons returns undefined on persistent reply keyboards', () => {
    expect(flattenButtons({ className: 'ReplyKeyboardMarkup', rows: [] })).toBeUndefined();
    expect(flattenButtons(undefined)).toBeUndefined();
  });

  it('flattenMessages maps over array', () => {
    const arr = [
      { id: 1, date: NOW / 1000, message: 'a' },
      { id: 2, date: NOW / 1000, message: 'b' },
    ];
    expect(flattenMessages(arr, NOW).map((m) => m.id)).toEqual([1, 2]);
  });
});
