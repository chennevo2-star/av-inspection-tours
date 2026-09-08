// Installs a real (in-memory) IndexedDB implementation as global `indexedDB`/`IDBKeyRange` so
// apps/web/lib/db/**'s Dexie-backed modules can be exercised under plain Node in vitest — no jsdom, no
// real browser. Harmless for packages that don't touch IndexedDB (packages/sync-engine's tests).
import "fake-indexeddb/auto";
