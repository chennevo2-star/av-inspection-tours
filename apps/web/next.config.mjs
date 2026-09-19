import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Makes `next dev` able to reach Cloudflare bindings (Hyperdrive, R2, etc). Despite this package's own
// docs suggesting it's always safe to call, it genuinely is NOT: real error hit here when it ran during
// `next build`/`opennextjs-cloudflare build` too (this file is evaluated at build time, not only at
// `next dev` time) -- it tries to resolve a *local* dev connection string for the Hyperdrive binding
// (one we haven't configured, since local dev keeps using PGlite per ADR-007, same as before this whole
// migration) and hard-fails the build. Guarding on NODE_ENV, the standard Next.js convention for
// "only during `next dev`" config-time setup, is what actually fixes it.
if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}

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
    "@av-inspection/ai-pipeline",
  ],
  // PGlite (packages/db's ADR-007 fallback) loads its own WASM/data files at runtime via
  // `new URL(..., import.meta.url)` + `fs.readFile`. Webpack's bundling of that (which
  // transpilePackages routes @av-inspection/db through) mangles the URL enough that Node's fs no
  // longer recognizes it as a real URL instance — real error hit here:
  // "TypeError [ERR_INVALID_ARG_TYPE]: ... Received an instance of URL" from inside PGlite's own
  // internals, only in API routes (never hit under Vitest, which doesn't webpack-bundle this at all —
  // see packages/db's own migrate.test.ts, which passes fine). Excluding it from the server bundle and
  // letting Node `require()` it directly at runtime is the standard fix for this class of native/WASM
  // library-under-webpack problem. Renamed from `experimental.serverComponentsExternalPackages` ->
  // top-level `serverExternalPackages` when upgrading to Next.js 16 (the old key now just warns/ignores).
  // "postgres" is here for a Cloudflare-specific reason too: it ships its own dedicated `workerd`
  // package-export condition (`./cf/src/index.js`, a battle-tested build with Hyperdrive-safe
  // `cloudflare:sockets` wiring already built in and bundler-safe) -- but that export condition is only
  // consulted for a package Next treats as external; a bundled/inlined import resolves through plain Node
  // conditions instead, silently getting the wrong build. This is the OFFICIAL documented fix (see
  // @opennextjs/cloudflare's own "workerd howto"), not a guess: without it, every real request to the
  // Cloudflare/Hyperdrive deploy hung until Workers force-killed it, confirmed over several failed
  // hand-rolled alternatives (including a custom cloudflare:sockets socket adapter) -- see this repo's git
  // log for the full saga before finding this, the actual root cause.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  // Next.js 16 defaults to Turbopack, which ignores this file's own `webpack()` hook entirely (real
  // build error otherwise: "using Turbopack, with a webpack config and no turbopack config"). Rather
  // than bet on translating the `.js`->`.ts` extensionAlias fix below into Turbopack's own (different)
  // config shape untested, `package.json`'s dev/build scripts explicitly pass `--webpack` to keep using
  // the exact same, already-proven webpack pipeline -- lower risk than re-deriving this from scratch.
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
