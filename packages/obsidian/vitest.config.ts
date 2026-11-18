import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The real 'obsidian' package ships type declarations only (no runtime —
    // its classes come from the running app), so tests get a fake in-memory
    // stand-in instead. Test-only: build.mjs marks 'obsidian' external, so
    // this alias never reaches the production bundle.
    alias: {
      obsidian: path.resolve(__dirname, 'src/__tests__/fakeObsidian.ts'),
    },
  },
});
