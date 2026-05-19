import type { TelegramClient } from '@tg/protocol';

export type CommandAction = (client: TelegramClient) => Promise<void>;

export const pending: { action?: CommandAction; streaming?: boolean } = {};
