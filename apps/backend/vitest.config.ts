import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Every file shares one real Postgres database, so files must not run concurrently.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
