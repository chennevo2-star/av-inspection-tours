#!/usr/bin/env node
/**
 * Keeps a Cloudflare quick tunnel (`cloudflared tunnel --url ...`) alive for real-device testing.
 *
 * Real bug this exists to work around: a quick tunnel's underlying connection can die silently while the
 * `cloudflared` PROCESS itself keeps running -- it just logs a repeating "control stream encountered a
 * failure" / "Retrying connection" loop forever without ever exiting or recovering on its own (confirmed
 * live 2026-09-09: a tunnel started the evening before was stuck retrying since ~06:01 UTC, hours before
 * anyone noticed). A plain "restart if the process exits" watchdog would never catch this, since the
 * process never exits -- this one also detects a sustained run of error lines with no successful
 * reconnect and kills+restarts the process itself when that happens.
 *
 * Writes the current live URL to tunnel-url.txt (empty when no tunnel is currently up) and a timestamped
 * history to tunnel-watchdog.log, both in this same directory -- read tunnel-url.txt any time to get the
 * current address without digging through logs.
 *
 * Usage: node scripts/tunnel-watchdog.mjs [localUrl]
 *   localUrl defaults to http://localhost:3000; override via the TUNNEL_TARGET env var or an argument.
 *   Cloudflared path defaults to the Windows winget install location; override via CLOUDFLARED_PATH.
 */
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL_FILE = path.join(__dirname, "tunnel-url.txt");
const LOG_FILE = path.join(__dirname, "tunnel-watchdog.log");

const CLOUDFLARED = process.env.CLOUDFLARED_PATH ?? "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe";
const LOCAL_URL = process.argv[2] ?? process.env.TUNNEL_TARGET ?? "http://localhost:3000";

const URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const STALL_TIMEOUT_MS = 90_000; // no successful connect/reconnect for this long after errors started -> treat as dead
const STALL_CHECK_INTERVAL_MS = 10_000;
const RESTART_BACKOFF_MS = 5_000;

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  try {
    appendFileSync(LOG_FILE, stamped + "\n");
  } catch {
    // Logging is best-effort -- never let a disk hiccup take down the watchdog itself.
  }
}

function writeCurrentUrl(url) {
  try {
    writeFileSync(URL_FILE, url ? `${url}\n` : "");
  } catch {
    // Same -- best-effort.
  }
}

/** Runs one cloudflared attempt to completion (process exit, or a forced kill after a detected stall). */
function runOnce() {
  return new Promise((resolve) => {
    log(`Starting cloudflared -> ${LOCAL_URL}`);
    const proc = spawn(CLOUDFLARED, ["tunnel", "--url", LOCAL_URL, "--edge-ip-version", "4"], {
      windowsHide: true,
    });

    let currentUrl = null;
    let lastGoodAt = Date.now();
    let sawErrorSinceGood = false;

    const stallTimer = setInterval(() => {
      if (sawErrorSinceGood && Date.now() - lastGoodAt > STALL_TIMEOUT_MS) {
        log(`No successful connection for ${STALL_TIMEOUT_MS / 1000}s after errors began -- killing and restarting.`);
        proc.kill();
      }
    }, STALL_CHECK_INTERVAL_MS);

    function handleChunk(chunk) {
      const text = chunk.toString();

      const match = text.match(URL_REGEX);
      if (match && match[0] !== currentUrl) {
        currentUrl = match[0];
        lastGoodAt = Date.now();
        sawErrorSinceGood = false;
        writeCurrentUrl(currentUrl);
        log(`Tunnel URL: ${currentUrl}`);
      }
      if (text.includes("Registered tunnel connection")) {
        lastGoodAt = Date.now();
        sawErrorSinceGood = false;
      }
      if (/\bERR\b/.test(text) || text.includes("Retrying connection")) {
        sawErrorSinceGood = true;
      }
    }

    proc.stdout.on("data", handleChunk);
    proc.stderr.on("data", handleChunk);

    proc.on("exit", (code, signal) => {
      clearInterval(stallTimer);
      writeCurrentUrl(null);
      log(`cloudflared stopped (code=${code}, signal=${signal}).`);
      resolve();
    });

    proc.on("error", (err) => {
      clearInterval(stallTimer);
      writeCurrentUrl(null);
      log(`Failed to launch cloudflared: ${err.message}`);
      resolve();
    });
  });
}

async function main() {
  log(`Tunnel watchdog starting (target: ${LOCAL_URL}, binary: ${CLOUDFLARED}).`);
  for (;;) {
    await runOnce();
    log(`Restarting in ${RESTART_BACKOFF_MS / 1000}s...`);
    await new Promise((r) => setTimeout(r, RESTART_BACKOFF_MS));
  }
}

main();
