"use client";

import { useEffect } from "react";

/** Registers the app-shell Service Worker (public/sw.js). Renders nothing. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      // Registration failure shouldn't break the app — it just means the app-shell offline cache
      // isn't active yet. Field data offline-first behavior (IndexedDB + sync queue) is unaffected.
      console.error("Service worker registration failed:", err);
    });
  }, []);

  return null;
}
