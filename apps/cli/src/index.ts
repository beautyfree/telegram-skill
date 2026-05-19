import { TelegramClient, TelegramError } from '@tg/protocol';
import { Command, CommanderError } from 'commander';
import { register as registerAction } from './commands/action';
import { register as registerChats } from './commands/chats';
import { register as registerDaemon } from './commands/daemon';
import { register as registerDoctor } from './commands/doctor';
import { register as registerEval } from './commands/eval';
import { register as registerListen } from './commands/listen';
import { register as registerLogin } from './commands/login';
import { register as registerLogout } from './commands/logout';
import { register as registerMe } from './commands/me';
import { register as registerMedia } from './commands/media';
import { register as registerMsg } from './commands/msg';
import { register as registerSaved } from './commands/saved';
import { register as registerSession } from './commands/session';
import { ensureDaemon, runDaemonMode } from './daemon';
import { formatHelp } from './help';
import { CliError, fail, mapErrorCode, warn } from './output';
import { pending } from './pending';

// --- Daemon mode: `tg --daemon` (must be checked before Commander) ---

if (process.argv.includes('--daemon')) {
  await runDaemonMode();
}

if (process.argv.includes('--caption-daemon')) {
  const { runCaptionDaemon } = await import('./caption-daemon');
  await runCaptionDaemon();
}

const MAX_FLOOD_WAIT_SEC = 30;

const program = new Command()
  .name('telegram-agent')
  .description('Telegram CLI for AI agents')
  .version(process.env.TG_VERSION ?? '0.0.0-dev', '--version')
  .option('--timeout <seconds>', 'Timeout in seconds')
  .helpOption('--help', 'Show help')
  .exitOverride()
  .configureHelp({ formatHelp })
  .configureOutput({
    writeOut: (str) => process.stdout.write(str),
    writeErr: (str) => process.stderr.write(str),
  });

registerMe(program);
registerChats(program);
registerMsg(program);
registerAction(program);
registerMedia(program);
registerSaved(program);
registerSession(program);
registerListen(program);
registerEval(program);
registerLogin(program);
registerLogout(program);
registerDaemon(program);
registerDoctor(program);

try {
  await program.parseAsync();
} catch (e) {
  if (e instanceof CommanderError) {
    if (e.code === 'commander.helpDisplayed' || e.code === 'commander.version') {
      process.exit(0);
    }
    // Clean up Commander error messages for JSON output
    let msg = e.message.replace(/^error:\s*/i, '');
    if (e.code === 'commander.unknownCommand') {
      const match = msg.match(/unknown command '([^']+)'/);
      msg = match
        ? `Unknown command: "${match[1]}". Run 'telegram-agent --help' for available commands.`
        : `Unknown command. Run 'telegram-agent --help' for available commands.`;
    } else if (e.code === 'commander.missingArgument') {
      msg = `${msg}. See --help for usage.`;
    } else if (e.code === 'commander.unknownOption') {
      msg = `${msg}. See --help for usage.`;
    }
    try {
      fail(msg, 'INVALID_ARGS');
    } catch {
      /* CliError */
    }
    process.exit(1);
  }
  if (e instanceof CliError) {
    process.exitCode = 1;
    process.exit();
  }
  throw e;
}

if (pending.action) {
  try {
    const { url } = await ensureDaemon();
    const client = new TelegramClient(url);

    const timeoutSec = program.opts().timeout ? Number(program.opts().timeout) : 3;
    if (!pending.streaming && timeoutSec > 0) {
      client.signal = AbortSignal.timeout(timeoutSec * 1000);
    }

    async function execute() {
      await pending.action?.(client);
    }

    try {
      await execute();
    } catch (e) {
      if (e instanceof CliError) throw e;
      if (e instanceof TelegramError && e.code === 429) {
        const match = e.message.match(/retry after (\d+)/);
        const waitSecs = match ? Number(match[1]) : 5;
        if (waitSecs <= MAX_FLOOD_WAIT_SEC) {
          warn(`Rate limited. Waiting ${waitSecs}s before retry...`);
          await new Promise((r) => setTimeout(r, waitSecs * 1000));
          await execute();
        } else {
          fail(`Rate limited. Retry after ${waitSecs}s`, 'FLOOD_WAIT');
        }
      } else {
        const err = e instanceof Error ? e : new Error(String(e));
        fail(err.message, mapErrorCode(err.message));
      }
    } finally {
      client.close();
    }
  } catch (e) {
    if (e instanceof CliError) {
      process.exitCode = 1;
    } else {
      try {
        fail(e instanceof Error ? e.message : String(e), 'UNKNOWN');
      } catch {
        /* CliError */
      }
      process.exitCode = 1;
    }
  }
}
