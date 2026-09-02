/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@pulse/shared', '@pulse/gateway', '@pulse/orchestrator'],
  eslint: {
    // Sibling workspace packages may not exist on disk yet during parallel build;
    // don't let lint block `next build`. Typecheck is the real gate (see `pnpm typecheck`).
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // The workspace packages are authored as ESM with explicit `.js` import
    // specifiers (correct for NodeNext runtime), but their files on disk are `.ts`.
    // Teach webpack to try `.ts`/`.tsx` when a `.js` import is requested so the
    // transpiled workspace packages resolve. Falls back to real `.js` files.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
