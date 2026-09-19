"use client";

import { useEffect } from "react";

/**
 * Registers the app-shell Service Worker (public/sw.js). Renders nothing.
 *
 * Also explicitly asks the browser to check for a newer sw.js beyond whatever its own default cadence
 * is (real bug found here, 2026-09-19: a genuine fix had shipped and was live on the server, but a real
 * device kept running the old, already-fixed-on-the-server code for a long time -- this app is normally
 * reopened from a home-screen icon rather than freshly navigated to in a browser tab, which is exactly
 * the case browsers are least aggressive about re-checking a Service Worker for updates). Calling
 * `registration.update()` right after registering, and again whenever the tab becomes visible (covers
 * "reopened the PWA from the background"), narrows that window without needing anything more invasive
 * like a forced reload.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    // Tracked via closure, not component state -- this effect runs once for the app's whole lifetime
    // (ServiceWorkerRegister is mounted once at the root and never unmounts in practice), so a plain
    // variable is enough and keeps the listener's own cleanup correctly attached to THIS effect, not
    // buried inside the registration promise's callback where a returned cleanup function would just be
    // silently discarded (promises have no cleanup semantics of their own).
    let registration: ServiceWorkerRegistration | null = null;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        registration = reg;
        void reg.update();
      })
      .catch((err) => {
        // Registration failure shouldn't break the app — it just means the app-shell offline cache
        // isn't active yet. Field data offline-first behavior (IndexedDB + sync queue) is unaffected.
        console.error("Service worker registration failed:", err);
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return null;
}
