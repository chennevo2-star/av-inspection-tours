import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal config deliberately -- no incremental-cache/R2 override yet. This app's real pages are almost
// entirely dynamic/user-data-driven (offline-first PWA shell + API routes), not the kind of static-ISR
// content that benefit most from OpenNext's R2-backed incremental cache. Add one later (a dedicated R2
// bucket, separate from the app's own file-storage bucket) only if a real caching need shows up.
export default defineCloudflareConfig();
