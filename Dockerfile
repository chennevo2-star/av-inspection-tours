# Production image for Cloudflare Containers (see CLOUDFLARE_DEPLOY.md).
#
# Debian-based (not Alpine) specifically because LibreOffice's headless DOCX->PDF conversion
# (apps/web/app/api/report/docx-to-pdf/route.ts, ADR-004) needs a real LibreOffice install with proper
# font support -- Alpine's musl-based LibreOffice packages are known to behave differently / be missing
# fonts. This does make the image large (LibreOffice alone is a few hundred MB); that is a deliberate
# tradeoff to keep the exact same PDF-generation code path already tested end-to-end on Windows, rather
# than rewriting report generation to fit a slimmer runtime.
FROM node:20-bookworm

# --no-install-recommends keeps this from pulling in a full desktop-app dependency tree (GTK themes,
# a help browser, etc.) that headless conversion never touches. fonts-liberation gives Hebrew/Latin text
# a metric-compatible fallback if a document references a font that isn't installed.
RUN apt-get update && \
    apt-get install -y --no-install-recommends libreoffice fonts-liberation fonts-dejavu-core && \
    rm -rf /var/lib/apt/lists/*

# Read directly by docx-to-pdf/route.ts via process.env.SOFFICE_PATH (its own fallback is a
# Windows-only path, which would 500 with a clear "LibreOffice not found" error on Linux otherwise).
ENV SOFFICE_PATH=/usr/bin/soffice

WORKDIR /app

# Copy the whole npm-workspaces monorepo (not just apps/web) before `npm ci` -- packages/* ship raw
# TypeScript with no build step of their own (see apps/web/next.config.js's transpilePackages comment),
# so they must be present as real, symlinked workspace packages for `next build` to resolve them.
COPY . .

RUN npm ci

RUN npm run build -w apps/web

ENV NODE_ENV=production
# `next start` reads PORT from the environment when no -p flag is given -- this is what Cloudflare
# Containers' default port (8080, see worker/index.ts's defaultPort) expects the process to bind to.
ENV PORT=8080
EXPOSE 8080

# Intentionally NOT using `output: "standalone"` / a pruned runtime stage: next.config.js has its own
# documented reason PGlite needs to stay a real, un-bundled node_modules package at runtime (native
# fs/WASM loading breaks under webpack bundling) -- so the full node_modules tree must exist at runtime,
# not just next build's traced subset.
CMD ["npm", "run", "start", "-w", "apps/web"]
