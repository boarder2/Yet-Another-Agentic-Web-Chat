/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        hostname: 's2.googleusercontent.com',
      },
    ],
  },
  // kokoro-js reads its voice .bin files relative to its own __dirname; it must
  // stay an external (unbundled) module so that path resolves correctly at runtime.
  serverExternalPackages: ['pdf-parse', 'playwright', 'dockerode', 'kokoro-js'],
  // Standalone tracing copies playwright's JS but misses data files it reads via a
  // runtime path (e.g. playwright-core/browsers.json), which crashes boot once the
  // scheduler pulls playwright in. Docker overlays the full packages; force the
  // build to include them so a raw `.next/standalone` run (local/CI e2e) works too.
  outputFileTracingIncludes: {
    '**': [
      './node_modules/playwright-core/**/*',
      './node_modules/playwright/**/*',
    ],
  },
};

export default nextConfig;
