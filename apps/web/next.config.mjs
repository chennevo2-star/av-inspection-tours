/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages (packages/shared-types, packages/sync-engine) ship raw TypeScript with no build
  // step (see ARCHITECTURE.md — deliberately simple for now, ADR-worthy to change). Next needs to be
  // told to run them through its own compiler rather than treating them as opaque node_modules.
  transpilePackages: [
    "@av-inspection/shared-types",
    "@av-inspection/sync-engine",
    "@av-inspection/db",
    "@av-inspection/storage",
  ],
  experimental: {
    // PGlite (packages/db's ADR-007 fallback) loads its own WASM/data files at runtime via
    // `new URL(..., import.meta.url)` + `fs.readFile`. Webpack's bundling of that (which
    // transpilePackages routes @av-inspection/db through) mangles the URL enough that Node's fs no
    // longer recognizes it as a real URL instance — real error hit here:
    // "TypeError [ERR_INVALID_ARG_TYPE]: ... Received an instance of URL" from inside PGlite's own
    // internals, only in API routes (never hit under Vitest, which doesn't webpack-bundle this at all —
    // see packages/db's own migrate.test.ts, which passes fine). Excluding it from the server bundle and
    // letting Node `require()` it directly at runtime is the standard fix for this class of native/WASM
    // library-under-webpack problem.
    serverComponentsExternalPackages: ["@electric-sql/pglite"],
  },
  webpack(config) {
    // The workspace packages use NodeNext-style relative imports (e.g. `./sync.js`, resolving to
    // `sync.ts`) — correct under their own "moduleResolution": "Bundler" tsconfig, and resolved fine by
    // tsc/Vite/Vitest, but Next's webpack resolver doesn't map a `.js` specifier to a `.ts` file on its
    // own. This tells it to try `.ts`/`.tsx` first. Without it, every such import 500s with
    // "Module not found" the moment a page imports one of these packages.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
