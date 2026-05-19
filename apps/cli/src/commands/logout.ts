import type { Command } from 'commander';
import { strip, success } from '../output';
import { pending } from '../pending';

export function register(parent: Command): void {
  parent
    .command('logout')
    .description('Log out of Telegram')
    .action(() => {
      pending.action = async (client) => {
        const res = await client.invoke({ _: 'logOut' });
        success(strip(res));
      };
    });
}
