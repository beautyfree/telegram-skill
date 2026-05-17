/**
 * Install / uninstall the `telegram` agent-skill bundle into every major
 * AI agent client. Each client has its own location convention:
 *
 *   Claude Code   →  ~/.claude/skills/telegram/                 (skill)
 *   Codex CLI     →  ~/.agents/skills/telegram/                 (skill)
 *   Cursor        →  ~/.cursor/plugins/local/telegram/          (plugin)
 *   Gemini CLI    →  ~/.gemini/skills/telegram/                 (skill)
 *   Cline         →  ~/.clinerules/telegram/                    (rule pack)
 *   Windsurf      →  <cwd>/.windsurf/rules/telegram.md          (rule)
 *
 * Goose uses YAML recipes that reference MCP servers — not a skill-file
 * model — so it's omitted; users wire the MCP server directly into a
 * recipe instead.
 */
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';

const SKILL_NAME = 'telegram';

/** Resolve the skills/ directory shipped with the npm package. */
function skillSourceDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/install.js → <pkgRoot>/skills/telegram
  const candidates = [
    join(here, '..', 'skills', SKILL_NAME),
    join(here, '..', '..', 'skills', SKILL_NAME),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`Skill source not found. Expected at one of:\n  ${candidates.join('\n  ')}`);
}

type Layout = 'skill' | 'cursor' | 'cline' | 'windsurf-rule';

interface ClientTarget {
  id: string;
  label: string;
  /** Heuristic path whose existence implies the client is installed. */
  detectPath: string;
  /** Where to write. */
  dest: string;
  layout: Layout;
}

function detectAll(): ClientTarget[] {
  const home = homedir();
  return [
    {
      id: 'claude',
      label: 'Claude Code',
      detectPath: join(home, '.claude'),
      dest: join(home, '.claude', 'skills', SKILL_NAME),
      layout: 'skill',
    },
    {
      id: 'codex',
      label: 'Codex CLI',
      detectPath: join(home, '.agents'),
      dest: join(home, '.agents', 'skills', SKILL_NAME),
      layout: 'skill',
    },
    {
      id: 'cursor',
      label: 'Cursor',
      detectPath: join(home, '.cursor'),
      dest: join(home, '.cursor', 'plugins', 'local', SKILL_NAME),
      layout: 'cursor',
    },
    {
      id: 'gemini',
      label: 'Gemini CLI',
      detectPath: join(home, '.gemini'),
      dest: join(home, '.gemini', 'skills', SKILL_NAME),
      layout: 'skill',
    },
    {
      id: 'cline',
      label: 'Cline',
      detectPath: join(home, '.clinerules'),
      dest: join(home, '.clinerules', SKILL_NAME),
      layout: 'cline',
    },
    {
      id: 'windsurf',
      label: 'Windsurf (project rule)',
      detectPath: join(process.cwd(), '.windsurf'),
      dest: join(process.cwd(), '.windsurf', 'rules'),
      layout: 'windsurf-rule',
    },
  ];
}

function copyDir(src: string, dst: string): number {
  mkdirSync(dst, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    if (statSync(s).isDirectory()) {
      count += copyDir(s, d);
    } else {
      writeFileSync(d, readFileSync(s));
      count++;
    }
  }
  return count;
}

function readFrontmatter(path: string): { name: string; description: string; body: string } {
  const raw = readFileSync(path, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return { name: SKILL_NAME, description: '', body: raw };
  const fm: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const eq = line.indexOf(':');
    if (eq === -1) continue;
    fm[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return { name: fm.name || SKILL_NAME, description: fm.description || '', body: m[2].trim() };
}

/** Cursor's native plugin layout (https://cursor.com/docs/plugins). */
function writeCursorPlugin(dest: string, src: string): number {
  mkdirSync(join(dest, '.cursor-plugin'), { recursive: true });
  const manifest = {
    name: SKILL_NAME,
    version: '1.0.0',
    description:
      'Operate a real Telegram user account from Cursor — read dialogs, search globally, send/edit/react, tag Saved Messages, moderate channels. Lazy-loaded skill plus optional MCP server.',
  };
  writeFileSync(join(dest, '.cursor-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(
    join(dest, 'mcp.json'),
    JSON.stringify({ mcpServers: { telegram: { command: 'npx', args: ['-y', 'mcp-telegram'] } } }, null, 2) + '\n'
  );
  const n = copyDir(src, join(dest, 'skills', SKILL_NAME));
  return n + 2;
}

/** Cline rule pack: SKILL-like .md plus references/ alongside. */
function writeClineRule(dest: string, src: string): number {
  mkdirSync(dest, { recursive: true });
  const skill = readFrontmatter(join(src, 'SKILL.md'));
  const body =
    `---\n` +
    `description: ${skill.description}\n` +
    `---\n\n` +
    skill.body +
    '\n';
  writeFileSync(join(dest, `${SKILL_NAME}.md`), body);
  const refsSrc = join(src, 'references');
  if (existsSync(refsSrc)) copyDir(refsSrc, join(dest, 'references'));
  return 1;
}

/** Windsurf rule: single .md with `trigger: model_decision`. */
function writeWindsurfRule(dest: string, src: string): number {
  mkdirSync(dest, { recursive: true });
  const skill = readFrontmatter(join(src, 'SKILL.md'));
  const body =
    `---\n` +
    `trigger: model_decision\n` +
    `description: ${skill.description}\n` +
    `---\n\n` +
    skill.body +
    '\n';
  writeFileSync(join(dest, `${SKILL_NAME}.md`), body);
  return 1;
}

function isInstalledAt(t: ClientTarget): boolean {
  switch (t.layout) {
    case 'cursor':
      return existsSync(join(t.dest, '.cursor-plugin', 'plugin.json'));
    case 'cline':
    case 'windsurf-rule':
      return existsSync(join(t.dest, `${SKILL_NAME}.md`));
    case 'skill':
    default:
      return existsSync(join(t.dest, 'SKILL.md'));
  }
}

function installOne(t: ClientTarget, src: string): number {
  switch (t.layout) {
    case 'cursor':
      if (existsSync(t.dest)) rmSync(t.dest, { recursive: true, force: true });
      return writeCursorPlugin(t.dest, src);
    case 'cline':
      return writeClineRule(t.dest, src);
    case 'windsurf-rule':
      return writeWindsurfRule(t.dest, src);
    case 'skill':
    default:
      if (existsSync(t.dest)) rmSync(t.dest, { recursive: true, force: true });
      return copyDir(src, t.dest);
  }
}

export async function runInstall(target?: string): Promise<void> {
  const src = skillSourceDir();
  const all = detectAll();
  const selected = !target || target === 'all' ? all : all.filter((c) => c.id === target);

  if (selected.length === 0) {
    process.stderr.write(
      JSON.stringify({
        ok: false,
        error: `Unknown target '${target}'. Valid: ${all.map((c) => c.id).join(', ')}, all.`,
      }) + '\n'
    );
    process.exit(1);
  }

  const report: any[] = [];
  for (const t of selected) {
    if (!target && !existsSync(t.detectPath)) {
      report.push({ client: t.id, status: 'skipped', reason: `not detected at ${t.detectPath}` });
      continue;
    }
    try {
      const files = installOne(t, src);
      report.push({ client: t.id, status: 'installed', dest: t.dest, files, layout: t.layout });
    } catch (err) {
      report.push({ client: t.id, status: 'error', error: (err as Error).message });
    }
  }
  process.stdout.write(JSON.stringify({ ok: true, installed: report }, null, 2) + '\n');
}

export async function runUninstall(target?: string): Promise<void> {
  const all = detectAll();
  const selected = !target || target === 'all' ? all : all.filter((c) => c.id === target);
  const report: any[] = [];
  for (const t of selected) {
    let removed = false;
    switch (t.layout) {
      case 'cline':
      case 'windsurf-rule': {
        const file = join(t.dest, `${SKILL_NAME}.md`);
        if (existsSync(file)) {
          rmSync(file, { force: true });
          removed = true;
          report.push({ client: t.id, status: 'removed', path: file });
        }
        const refs = join(t.dest, 'references');
        if (existsSync(refs)) rmSync(refs, { recursive: true, force: true });
        break;
      }
      default: {
        if (existsSync(t.dest)) {
          rmSync(t.dest, { recursive: true, force: true });
          removed = true;
          report.push({ client: t.id, status: 'removed', path: t.dest });
        }
      }
    }
    if (!removed) report.push({ client: t.id, status: 'absent' });
  }
  process.stdout.write(JSON.stringify({ ok: true, removed: report }, null, 2) + '\n');
}

export async function runDoctor(): Promise<void> {
  const all = detectAll();
  const out = all.map((t) => ({
    client: t.id,
    label: t.label,
    detected: existsSync(t.detectPath),
    detectPath: t.detectPath,
    dest: t.dest,
    layout: t.layout,
    installed: isInstalledAt(t),
  }));
  process.stdout.write(JSON.stringify({ ok: true, clients: out }, null, 2) + '\n');
}
