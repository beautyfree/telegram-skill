import path from 'node:path';
import type { Command } from 'commander';
import { fail, strip, success } from '../output';
import { pending } from '../pending';

export function register(parent: Command): void {
  parent
    .command('eval')
    .description('Execute JavaScript with a connected TDLib client')
    .argument('[code...]', 'JavaScript code to execute')
    .option('--file <path>', 'Read code from a file path')
    .action((codeArgs: string[], opts: { file?: string }) => {
      pending.action = async (client) => {
        let code: string;
        if (opts.file) {
          const { existsSync, readFileSync } = await import('node:fs');
          if (!existsSync(opts.file)) fail(`File not found: ${opts.file}`, 'INVALID_ARGS');
          code = readFileSync(opts.file, 'utf-8');
          if (!code) fail(`File is empty: ${opts.file}`, 'INVALID_ARGS');
        } else if (codeArgs.length > 0) {
          code = codeArgs.join(' ');
        } else if (!process.stdin.isTTY) {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk as Buffer);
          }
          code = Buffer.concat(chunks).toString('utf-8').trimEnd();
          if (!code) fail('No code received from stdin', 'INVALID_ARGS');
        } else {
          fail(
            'No code provided. Pass code as argument, via stdin (heredoc), or --file.',
            'INVALID_ARGS',
          );
        }
        const fn = new Function(
          'client',
          'success',
          'fail',
          'strip',
          'fs',
          'path',
          `return (async () => { ${code} })()`,
        );
        const fs = await import('node:fs');
        const result = await fn(client, success, fail, strip, fs, path);
        if (result !== undefined) {
          try {
            success(strip(result));
          } catch {
            fail('eval returned a non-serializable value', 'INVALID_ARGS');
          }
        }
      };
    });
}
