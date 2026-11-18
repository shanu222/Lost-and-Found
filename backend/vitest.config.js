import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.js'],
    setupFiles: ['./test/env.js'],
    fileParallelism: false, // tests share one database
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
