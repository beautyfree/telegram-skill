import * as p from '@clack/prompts';
import { TelegramClient } from '@tg/protocol';
import type { Command } from 'commander';
import { ensureDaemon } from '../daemon';

const CODE_TYPE_LABEL: Record<string, string> = {
  authenticationCodeTypeTelegramMessage: 'Telegram',
  authenticationCodeTypeSms: 'SMS',
  authenticationCodeTypeCall: 'phone call',
  authenticationCodeTypeFlashCall: 'flash call',
  authenticationCodeTypeFragment: 'Fragment',
  authenticationCodeTypeFirebaseAndroid: 'Firebase',
  authenticationCodeTypeFirebaseIos: 'Firebase',
};

function codeTypeLabel(type?: string): string {
  if (!type) return 'Telegram';
  return CODE_TYPE_LABEL[type] ?? type;
}

interface CodeInfo {
  type?: { _?: string };
  next_type?: { _?: string };
  phone_number?: string;
  timeout?: number;
}

function getCodeInfo(state: Record<string, unknown>): CodeInfo | undefined {
  return state.code_info as CodeInfo | undefined;
}

export function register(parent: Command): void {
  parent
    .command('login')
    .description('Log in to Telegram (interactive)')
    .action(async () => {
      p.intro('Telegram Authentication');

      let client: TelegramClient | undefined;

      try {
        const { url } = await ensureDaemon();
        client = new TelegramClient(url);

        let state = await client.getAuthState();

        // Already logged in
        if (state.ready) {
          const me = await client.invoke({ _: 'getMe' });
          p.log.success(formatUser(me));
          p.outro('Already logged in');
          process.exit(0);
        }

        // Step 1: Phone number
        if (state.state === 'wait_phone_number') {
          const phone = await p.text({
            message: 'Phone number',
            placeholder: '+1234567890',
            validate: (v) => {
              if (!v?.trim()) return 'Required';
            },
          });
          if (p.isCancel(phone)) {
            p.cancel('Cancelled');
            process.exit(0);
          }
          state = await client.submitPhone(phone);
        }

        // Step 2: Verification code
        if (state.state === 'wait_code') {
          const codeInfo = getCodeInfo(state as Record<string, unknown>);
          const sentVia = codeTypeLabel(codeInfo?.type?._);

          p.log.info(`Code sent via ${sentVia}`);

          let codeState = state;
          while (codeState.state === 'wait_code') {
            const info = getCodeInfo(codeState as Record<string, unknown>);
            const resendVia = info?.next_type?._ ? codeTypeLabel(info.next_type._) : null;
            const timeout = info?.timeout ?? 0;

            const resendLabel = resendVia ? `Resend via ${resendVia}` : 'Resend code';

            const action = await p.select({
              message: 'Choose an option',
              options: [
                { value: 'enter' as const, label: 'Enter code' },
                {
                  value: 'resend' as const,
                  label: resendLabel,
                  hint: timeout > 0 ? `available in ${timeout}s` : undefined,
                },
              ],
            });
            if (p.isCancel(action)) {
              p.cancel('Cancelled');
              process.exit(0);
            }

            if (action === 'resend') {
              try {
                codeState = await client.resendCode();
                const newInfo = getCodeInfo(codeState as Record<string, unknown>);
                const newVia = codeTypeLabel(newInfo?.type?._);
                p.log.info(`Code resent via ${newVia}`);
              } catch (e) {
                p.log.warning(e instanceof Error ? e.message : String(e));
              }
              continue;
            }

            const code = await p.password({
              message: 'Verification code',
              validate: (v) => {
                if (!v?.trim()) return 'Required';
              },
            });
            if (p.isCancel(code)) {
              p.cancel('Cancelled');
              process.exit(0);
            }
            codeState = await client.submitCode(code);
          }
          state = codeState;
        }

        // Step 3: 2FA password
        if (state.state === 'wait_password') {
          const hint = (state as Record<string, unknown>).password_hint as string | undefined;
          const message = hint ? `2FA password (hint: ${hint})` : '2FA password';

          const pw = await p.password({
            message,
            validate: (v) => {
              if (!v?.trim()) return 'Required';
            },
          });
          if (p.isCancel(pw)) {
            p.cancel('Cancelled');
            process.exit(0);
          }
          state = await client.submitPassword(pw);
        }

        // Done
        if (state.ready) {
          const me = await client.invoke({ _: 'getMe' });
          p.outro(formatUser(me));
          process.exit(0);
        }

        p.log.error(`Unexpected state: ${state.state}`);
        process.exit(1);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        p.log.error(msg);
        process.exit(1);
      } finally {
        client?.close();
      }
    });
}

function formatUser(me: {
  first_name?: string;
  usernames?: { editable_username?: string };
}): string {
  const name = me.first_name ?? 'Unknown';
  const username = me.usernames?.editable_username;
  return username ? `Logged in as ${name} (@${username})` : `Logged in as ${name}`;
}
