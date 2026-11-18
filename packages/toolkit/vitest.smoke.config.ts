import { defineConfig } from 'vitest/config';

// Separate from vitest.config.ts (not just a CLI path filter on top of it)
// so there's no ambiguity from that config's own smoke/ exclude: this one
// exists solely to run smoke/, with its own generous timeout for the real
// npm pack + npm install + subprocess cycle those tests run.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['smoke/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
