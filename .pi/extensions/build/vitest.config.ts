import { defineConfig } from 'vitest/config';

// Rooted at this directory so the suite runs identically from the repo root
// (`npx vitest run --config .pi/extensions/build/vitest.config.ts`) or from here.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
