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
};

export default nextConfig;
