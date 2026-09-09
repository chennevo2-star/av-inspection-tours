# scripts/

## tunnel-watchdog.mjs

Keeps a Cloudflare quick tunnel alive for real-device testing (phone over the internet, not just LAN).

```bash
node scripts/tunnel-watchdog.mjs
```

Requires the local dev server already running (`npm run dev -w apps/web`, port 3000) and `cloudflared`
installed (`winget install --id Cloudflare.cloudflared`).

**Why this exists**: a Cloudflare quick tunnel's connection can die silently while the `cloudflared`
process keeps running — it just logs a repeating connection-retry failure forever without exiting or
recovering on its own. This script detects that (no successful reconnect for 90s after errors start) and
kills + restarts `cloudflared` itself, in addition to the obvious case of the process just crashing.

**Current URL**: `scripts/tunnel-url.txt` (gitignored, regenerated on every run/restart — empty when no
tunnel is currently up). **History**: `scripts/tunnel-watchdog.log` (gitignored).

No Cloudflare account or domain needed — this is the free anonymous "quick tunnel" mode, so the URL
changes every time the tunnel restarts (that's a Cloudflare limitation, not something this script can fix;
a stable URL needs a domain managed in Cloudflare DNS routed to a named, authenticated tunnel instead).
