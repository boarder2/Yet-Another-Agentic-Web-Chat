import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Unit tests are the narrow exception to the e2e-only policy: pure modules only
// (no DOM, no network, no LLM), tested through their interface. See CLAUDE.md.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
