import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Unit tests cover isolated behavior through interfaces. Keep this suite fast:
// no DOM, network, or LLM. See CLAUDE.md.
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      'server-only': fileURLToPath(
        new URL('./test/server-only-stub.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Pinned so encryption-touching modules never depend on the developer's
    // config.toml — CI has none, and an ambient passphrase would make results
    // machine-dependent.
    env: { ENCRYPTION_PASSPHRASE: 'unit-test-passphrase-not-a-secret' },
  },
});
