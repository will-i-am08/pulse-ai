import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Monorepo root (…/apps/web -> repo root). Anchors output-file tracing so nft
// resolves the pnpm store correctly and produces stable include globs.
const repoRoot = path.join(__dirname, '..', '..');

// Assets to force into any serverless function that reaches the orchestrator's
// image path. These are loaded by DYNAMIC paths that nft can't trace from a
// require(): the fonts via readFileSync(fileURLToPath(import.meta.url)…), and
// satori/harfbuzz's .wasm at runtime. sharp/@img/resvg/satori JS need no entry
// here — they're direct deps and get traced through the require graph.
//
// IMPORTANT: outputFileTracingIncludes globs resolve relative to THIS app dir
// (apps/web), not to outputFileTracingRoot — verified empirically — so reach up
// to the repo root with ../../.
const tracingIncludes = [
  '../../packages/orchestrator/src/assets/*.ttf',
  '../../node_modules/.pnpm/**/node_modules/harfbuzzjs/*.wasm',
  '../../node_modules/.pnpm/**/node_modules/satori/*.wasm',
  // Backstop: any other .wasm in the dependency store.
  '../../node_modules/.pnpm/**/*.wasm',
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@pulse/shared', '@pulse/gateway', '@pulse/orchestrator'],
  // Native / heavy image-processing deps reach the server bundle transitively
  // through the orchestrator barrel (imaging.ts etc.) — e.g. the inbound Twilio
  // webhook -> @pulse/gateway -> @pulse/orchestrator. Keep them external so
  // webpack doesn't try to bundle their .node binaries (which breaks the build);
  // they're require()d at runtime instead (see outputFileTracing* below, which
  // guarantees they're actually shipped into the serverless functions).
  serverExternalPackages: ['@resvg/resvg-js', 'sharp', 'satori'],
  // In a pnpm monorepo, nft won't reliably trace an externalised package that is
  // only imported through a transpiled workspace package, so the runtime
  // require('sharp') 500s with "Cannot find module 'sharp'". Pin the trace root
  // to the repo and force-include the native packages (sharp ships its binaries
  // as separate @img/* packages) for the routes that reach them.
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    // Same include set for every route that reaches the orchestrator's imaging
    // path. Covers: sharp's JS + its separate @img/* native binaries; resvg's
    // JS + @resvg/* native binaries; satori's JS; and — crucially — the runtime
    // .wasm assets that satori loads by a dynamic path (harfbuzzjs' hb.wasm,
    // yoga-wasm-web's yoga.wasm), which nft can't see statically. The trailing
    // **/*.wasm catch-all backstops any other wasm asset in the dep store.
    '/api/webhooks/twilio': tracingIncludes,
    '/api/webhooks/linq': tracingIncludes,
  },
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
