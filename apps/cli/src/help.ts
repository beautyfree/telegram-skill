/**
 * Custom help formatter for Commander.js — matches the original tg CLI style.
 *
 * Three levels:
 * - Root:  categorized command listing with header info
 * - Group: simple subcommand listing
 * - Leaf:  title, inline usage line, flags table
 */

import type { Command, Help } from 'commander';

// ─── Category definitions for root help ───

interface Category {
  title: string;
  entries: [cmd: string, desc: string][];
}

const CATEGORIES: Category[] = [
  {
    title: 'Identity',
    entries: [
      ['me', 'Get current user info'],
      ['info', 'Get detailed info about a user, group, or channel'],
    ],
  },
  {
    title: 'Chats',
    entries: [
      ['chats list', 'List your conversations'],
      ['chats search', 'Search chats, bots, groups, or channels by name'],
      ['chats members', 'List members of a group or channel'],
    ],
  },
  {
    title: 'Messages',
    entries: [
      ['msg list', 'Get message history from a chat'],
      ['msg get', 'Get a single message by ID'],
      ['msg search', 'Search messages across your chats or in a specific chat'],
    ],
  },
  {
    title: 'Actions',
    entries: [
      ['action send', 'Send a message to a chat'],
      ['action edit', 'Edit a sent message'],
      ['action delete', 'Delete messages from a chat'],
      ['action forward', 'Forward messages from one chat to another'],
      ['action pin', 'Pin a message in a chat'],
      ['action unpin', 'Unpin a message or all messages in a chat'],
      ['action react', 'Add or remove a reaction on a message'],
      ['action click', 'Click an inline keyboard button'],
    ],
  },
  {
    title: 'Real-time',
    entries: [['listen', 'Stream real-time events (NDJSON). Requires --chat or --type.']],
  },
  {
    title: 'Media',
    entries: [
      ['media download', 'Download media from a message or by file ID'],
      ['media transcribe', 'Transcribe a voice or video note to text (Telegram Premium)'],
      ['media caption', 'Caption an image attached to a Telegram message (Florence-2, local)'],
      ['media caption run', 'Caption arbitrary local image files'],
      ['media caption download', 'Pre-fetch Florence-2 model weights (~150 MB)'],
    ],
  },
  {
    title: 'Saved Messages (Premium)',
    entries: [
      ['saved tags', 'List your Saved-Messages reaction tags + counts + custom titles'],
      ['saved tag-rename', 'Rename (or clear) the custom title of a tag emoji'],
      ['saved default-tags', 'Server-suggested default emoji set'],
      ['saved search', 'Search Saved Messages by tag, query, or both'],
      ['saved history', 'Walk Saved Messages history'],
    ],
  },
  {
    title: 'Portable session',
    entries: [
      ['session export', 'Dump current TDLib session as a base64 blob (=credential)'],
      ['session import', 'Import a previously exported session blob'],
    ],
  },
  {
    title: 'Advanced',
    entries: [['eval', 'Execute JavaScript with a connected TDLib client']],
  },
  {
    title: 'Auth',
    entries: [
      ['login', 'Log in to Telegram (interactive)'],
      ['logout', 'Log out of Telegram'],
    ],
  },
  {
    title: 'Daemon',
    entries: [
      ['daemon start', 'Start the background daemon'],
      ['daemon stop', 'Stop the background daemon'],
      ['daemon status', 'Check if daemon is running'],
      ['daemon log', 'Show last 20 lines of daemon log'],
    ],
  },
];

// ─── Formatters ───

function formatRootHelp(): string {
  const lines: string[] = [];
  lines.push('telegram-agent — Telegram CLI for AI agents');
  lines.push('');
  lines.push('Usage: telegram-agent <command> [args] [--flags]');
  lines.push('');
  lines.push('stdout: JSON { ok, data } | { ok, error, code }');
  lines.push('stderr: warnings');
  lines.push('Entities: numeric ID | @username | +phone | t.me/link | "me"');
  lines.push('');
  lines.push('Global flags:');
  lines.push('  --timeout N   Timeout in seconds');

  for (const cat of CATEGORIES) {
    lines.push('');
    lines.push(`${cat.title}:`);
    const pad = Math.max(...cat.entries.map(([c]) => c.length)) + 2;
    for (const [cmd, desc] of cat.entries) {
      lines.push(`  ${cmd.padEnd(pad)}${desc}`);
    }
  }

  lines.push('');
  lines.push("Run 'telegram-agent <command> --help' for command-specific usage.");
  lines.push('');
  return lines.join('\n');
}

function formatGroupHelp(cmd: Command): string {
  const name = cmd.name();
  const subs = cmd.commands.filter((c) => c.name() !== 'help');
  const lines: string[] = [];

  lines.push(`Available ${name} commands:`);
  lines.push('');

  const pad = Math.max(...subs.map((c) => `${name} ${c.name()}`.length)) + 2;
  for (const sub of subs) {
    const full = `${name} ${sub.name()}`;
    lines.push(`  ${full.padEnd(pad)}${sub.description()}`);
  }

  lines.push('');
  lines.push(`Run 'telegram-agent ${name} <command> --help' for usage.`);
  lines.push('');
  return lines.join('\n');
}

function formatLeafHelp(cmd: Command): string {
  const lines: string[] = [];

  // Build full command path (e.g. "chats list")
  const parts: string[] = [];
  let c: Command | null = cmd;
  while (c) {
    if (c.name() !== 'telegram-agent') parts.unshift(c.name());
    c = c.parent;
  }
  const fullName = parts.join(' ');

  // Title line
  lines.push(`${fullName} — ${cmd.description()}`);
  lines.push('');

  // Usage line with args and flags inline
  const args = cmd.registeredArguments.map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`));

  const opts = cmd.options.filter((o) => !o.hidden && o.long !== '--help');
  const flagParts = opts.map((o) => {
    const flag = o.long ?? o.short ?? '';
    const valueMatch = o.flags.match(/<([^>]+)>/);
    if (!valueMatch) {
      return `[${flag}]`;
    }
    return `[${flag} ${(valueMatch[1] ?? 'N').toUpperCase()}]`;
  });

  const usageLine = ['telegram-agent', ...parts, ...args, ...flagParts].join(' ');
  lines.push(`  ${usageLine}`);

  // Flags section
  if (opts.length > 0) {
    lines.push('');
    lines.push('Flags:');
    const pad = Math.max(...opts.map((o) => (o.long ?? o.short ?? '').length)) + 2;
    for (const o of opts) {
      const flag = o.long ?? o.short ?? '';
      lines.push(`  ${flag.padEnd(pad)}${o.description}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ─── Public API ───

export function formatHelp(cmd: Command, _helper: Help): string {
  // Root command
  if (!cmd.parent) return formatRootHelp();

  // Group command (has subcommands that aren't just 'help')
  const realSubs = cmd.commands.filter((c) => c.name() !== 'help');
  if (realSubs.length > 0) return formatGroupHelp(cmd);

  // Leaf command
  return formatLeafHelp(cmd);
}
