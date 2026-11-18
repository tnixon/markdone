import { defineConfig } from 'vitest/config';

// This package has no unit tests of its own (it's a thin bundler around
// packages/cli and packages/mcp, whose own suites already cover the logic).
// passWithNoTests keeps `npm test` (and the root `npm test --workspaces`
// aggregator) green rather than erroring on zero matches. The real coverage
// for the built artifact is smoke/, run separately via `npm run test:smoke`
// — see vitest.smoke.config.ts — so it never runs as part of this default
// config's fast `vitest run`.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    exclude: ['**/node_modules/**', 'smoke/**'],
  },
});
