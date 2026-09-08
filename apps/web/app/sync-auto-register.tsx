"use client";

import { useEffect } from "react";
import { wireAutoSync } from "../lib/sync/sync-manager";

/** Wires the online-event auto-sync listener (spec §19) once per app load. Renders nothing. */
export function SyncAutoRegister() {
  useEffect(() => {
    wireAutoSync();
  }, []);

  return null;
}
