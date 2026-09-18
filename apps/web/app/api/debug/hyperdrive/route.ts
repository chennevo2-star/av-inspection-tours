import { NextResponse } from "next/server";

/**
 * TEMPORARY diagnostic route -- not part of the real app, added only to see exactly where the Hyperdrive
 * connection is failing without needing `wrangler tail` (unreliable over this network right now). Delete
 * this file once the live Hyperdrive connection bug is understood.
 */
function redact(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = "***REDACTED***";
    return url.toString();
  } catch {
    return "UNPARSEABLE: " + connectionString.slice(0, 20) + "...";
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms)),
  ]);
}

const cloudflareSocketsSpecifier: string = "cloudflare:sockets";

export async function GET() {
  const steps: Record<string, unknown> = {};
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = getCloudflareContext();
    const hyperdrive = (env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
    if (!hyperdrive?.connectionString) {
      return NextResponse.json({ error: "no HYPERDRIVE binding" });
    }
    const url = new URL(hyperdrive.connectionString);
    steps.connectionString = redact(hyperdrive.connectionString);
    steps.hostname = url.hostname;
    steps.port = url.port;
    steps.isWorkersRuntime = typeof (globalThis as { Cloudflare?: unknown }).Cloudflare !== "undefined";

    steps.step = "importing cloudflare:sockets";
    const { connect } = (await import(cloudflareSocketsSpecifier)) as {
      connect: (address: { hostname: string; port: number }) => {
        opened: Promise<unknown>;
        closed: Promise<void>;
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
        close(): Promise<void>;
      };
    };
    steps.step = "connect() called";
    const sock = connect({ hostname: url.hostname, port: Number(url.port) });
    steps.step = "awaiting sock.opened";
    const openedInfo = await withTimeout(sock.opened, 8000, "sock.opened");
    steps.opened = JSON.parse(JSON.stringify(openedInfo ?? {}));
    steps.step = "sending Postgres SSLRequest-less raw byte to test write, then reading response";

    // Try a minimal raw write (a Postgres StartupMessage-like probe isn't needed here -- we only want to
    // confirm the TCP pipe itself is alive, so just check we CAN get a writer/reader without hanging).
    const writer = sock.writable.getWriter();
    steps.step = "got writer, writing 1 byte";
    await withTimeout(writer.write(new Uint8Array([0])), 5000, "writer.write");
    steps.wroteByte = true;
    writer.releaseLock();

    await sock.close().catch(() => {});
    steps.step = "done, closed";
    return NextResponse.json({ ok: true, steps });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      steps,
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}
