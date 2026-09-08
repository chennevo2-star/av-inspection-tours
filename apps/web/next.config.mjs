/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages (packages/shared-types, packages/sync-engine) ship raw TypeScript with no build
  // step (see ARCHITECTURE.md — deliberately simple for now, ADR-worthy to change). Next needs to be
  // told to run them through its own compiler rather than treating them as opaque node_modules.
  transpilePackages: ["@av-inspection/shared-types", "@av-inspection/sync-engine"],
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
