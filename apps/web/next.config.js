/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@pulse/shared', '@pulse/gateway', '@pulse/orchestrator'],
  // Native / heavy image-processing deps are reachable through the orchestrator
  // barrel (imaging.ts) but never executed in the web app. Keep them external so
  // webpack doesn't try to bundle their .node binaries (which breaks the build).
  serverExternalPackages: ['@resvg/resvg-js', 'sharp', 'satori'],
  eslint: {
    // Sibling workspace packages may not exist on disk yet during parallel build;
    // don't let lint block `next build`. Typecheck is the real gate (see `pnpm typecheck`).
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    // The workspace packages are authored as ESM with explicit `.js` import
    // specifiers (correct for NodeNext runtime), but their files on disk are `.ts`.
    // Teach webpack to try `.ts`/`.tsx` when a `.js` import is requested so the
    // transpiled workspace packages resolve. Falls back to real `.js` files.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    // Native image-processing deps reach the server bundle transitively (via the
    // transpiled gateway/orchestrator packages → imaging.ts). Their `.node`
    // binaries can't be webpack-bundled, so keep them as runtime `require()`s.
    // serverExternalPackages alone doesn't catch imports from transpiled
    // workspace packages, so pin them as webpack externals on the server too.
    if (isServer) {
      const externals = ['@resvg/resvg-js', 'sharp', 'satori'];
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        ...externals.map((pkg) => ({ [pkg]: `commonjs ${pkg}` })),
      ];
    }
    return config;
  },
};

export default nextConfig;
