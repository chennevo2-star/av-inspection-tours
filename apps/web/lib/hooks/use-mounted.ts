"use client";

import { useEffect, useState } from "react";

/**
 * True only after the component has mounted in the browser. Guards any Dexie/IndexedDB access against
 * running during Next.js server-side rendering (where IndexedDB doesn't exist) — see
 * apps/web/lib/db/local-db.ts's getLocalDb() and ARCHITECTURE.md. Every component that reads/writes
 * local data should gate on this before calling getLocalDb() or useLiveQuery against it.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
