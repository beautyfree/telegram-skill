import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // e2e tests spawn `node dist/cli.js`, so they require a prior build.
    // `npm test` runs `tsc` first via `prepublishOnly`-style invocation
    // in CI; locally we hint with the `build:before-test` pattern in
    // the script chain. Add a 30s timeout for the e2e bucket since
    // process spawns are slower than in-process unit tests.
    testTimeout: 30_000,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/daemon/entry.ts', 'src/auth-*.ts', 'src/logger.ts'],
    },
  },
});
