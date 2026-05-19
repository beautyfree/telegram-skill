import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import type * as Td from 'tdlib-types';
import { captionFiles, downloadModel, isModelDownloaded } from '../caption';
import { getFileId } from '../enrich';
import { fail, success, warn } from '../output';
import { pending } from '../pending';
import { resolveChatId } from '../resolve';
import { getContentMimeType } from './_helpers';

export function register(parent: Command): void {
  const media = parent.command('media').description('Media operations');

  media
    .command('download')
    .description('Download media from a message or by file ID')
    .argument('[chat]', 'Chat ID, username, or link')
    .argument('[msgId]', 'Message ID')
    .option('--output <path>', 'Output file path (default: auto-named in cwd)')
    .option('--file-id <id>', 'Download directly by TDLib file ID')
    .action(
      (
        chatArg: string | undefined,
        msgIdArg: string | undefined,
        opts: { output?: string; fileId?: string },
      ) => {
        pending.action = async (client) => {
          let fileId: number;
          let mimeType: string | undefined;

          if (opts.fileId) {
            fileId = Number(opts.fileId);
            if (!Number.isFinite(fileId)) fail('--file-id must be a number', 'INVALID_ARGS');
          } else {
            if (!chatArg)
              fail('Missing required argument: <chat>. Or use --file-id <id>', 'INVALID_ARGS');
            if (!msgIdArg) fail('Missing required argument: <msgId>', 'INVALID_ARGS');
            const chatId = await resolveChatId(client, chatArg);
            const msg = await client.invoke({
              _: 'getMessage',
              chat_id: chatId,
              message_id: Number(msgIdArg),
            });
            const extracted = getFileId(msg.content);
            if (!extracted) fail('Message has no downloadable media', 'NOT_FOUND');
            fileId = extracted;
            mimeType = getContentMimeType(msg.content);
          }

          const downloaded = await client.invoke({
            _: 'downloadFile',
            file_id: fileId,
            priority: 1,
            offset: 0,
            limit: 0,
            synchronous: true,
          });

          if (!downloaded.local.is_downloading_completed) {
            fail('Failed to download media', 'UNKNOWN');
          }

          const localPath = downloaded.local.path;
          if (opts.output) {
            copyFileSync(localPath, opts.output);
          }

          success({
            file: path.resolve(opts.output ?? localPath),
            size: downloaded.size,
            ...(mimeType ? { mime_type: mimeType } : {}),
          });
        };
      },
    );

  media
    .command('transcribe')
    .description('Transcribe a voice or video note to text (Telegram Premium)')
    .argument('<chat>', 'Chat ID, username, or link')
    .argument('<msgId>', 'Message ID')
    .action((chatArg: string, msgIdArg: string) => {
      pending.action = async (client) => {
        const chatId = await resolveChatId(client, chatArg);
        const messageId = Number(msgIdArg);

        const msg = await client.invoke({
          _: 'getMessage',
          chat_id: chatId,
          message_id: messageId,
        });
        const getResult = (content: Td.MessageContent) => {
          if (content._ === 'messageVoiceNote') return content.voice_note.speech_recognition_result;
          if (content._ === 'messageVideoNote') return content.video_note.speech_recognition_result;
          return undefined;
        };

        const existing = getResult(msg.content);
        if (existing?._ === 'speechRecognitionResultText') {
          success({ text: existing.text });
          return;
        }

        const contentType = msg.content._;
        if (contentType !== 'messageVoiceNote' && contentType !== 'messageVideoNote') {
          fail('Message is not a voice or video note', 'INVALID_ARGS');
        }

        await client.invoke({
          _: 'recognizeSpeech',
          chat_id: chatId,
          message_id: messageId,
        });

        const MAX_ATTEMPTS = 30;
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const updated = await client.invoke({
            _: 'getMessage',
            chat_id: chatId,
            message_id: messageId,
          });
          const result = getResult(updated.content);
          if (!result || result._ === 'speechRecognitionResultPending') continue;
          if (result._ === 'speechRecognitionResultText') {
            success({ text: result.text });
            return;
          }
          if (result._ === 'speechRecognitionResultError') {
            fail(`Speech recognition failed: ${result.error.message}`, 'UNKNOWN');
          }
        }
        fail('Speech recognition timed out', 'UNKNOWN');
      };
    });

  // --- Caption subcommands (no TDLib needed) ---

  const caption = media
    .command('caption')
    .description('Image captioning with local Florence-2 model');

  caption
    .command('download')
    .description('Download the Florence-2-base model (q4, ~330 MB)')
    .action(async () => {
      warn('Downloading Florence-2-base (q4)...');
      try {
        await downloadModel();
        success({ status: 'downloaded' });
      } catch (e) {
        fail(`Download failed: ${e instanceof Error ? e.message : String(e)}`, 'UNKNOWN');
      }
    });

  caption
    .command('run')
    .description('Caption one or more image files')
    .argument('<files...>', 'Image file paths')
    .option('--max-tokens <n>', 'Max tokens per caption', '30')
    .action(async (files: string[], opts: { maxTokens: string }) => {
      if (!isModelDownloaded()) {
        fail('Model not downloaded. Run "tg media caption download" first.', 'NOT_FOUND');
      }

      const resolved = files.map((f) => (path.isAbsolute(f) ? f : path.resolve(f)));
      for (const f of resolved) {
        if (!existsSync(f)) fail(`File not found: ${f}`, 'NOT_FOUND');
      }

      try {
        const data = await captionFiles(resolved, Number(opts.maxTokens));
        success(data);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e), 'UNKNOWN');
      }
    });
}
