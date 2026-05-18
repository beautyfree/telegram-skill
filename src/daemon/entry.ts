#!/usr/bin/env node
/**
 * Daemon process entry point. Invoked by spawn.ts. Idle-exits itself
 * after 10 minutes of inactivity; cleans up its socket and pid file on
 * exit.
 */
import { config as dotenvConfig } from 'dotenv';
import { logger } from '../logger.js';
import { startDaemon } from './server.js';

dotenvConfig();

process.on('uncaughtException', (err) => {
  logger.error('daemon uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  logger.error('daemon unhandledRejection', reason as Error);
});

startDaemon().catch((err) => {
  logger.error('daemon startup failed', err);
  process.exit(1);
});
