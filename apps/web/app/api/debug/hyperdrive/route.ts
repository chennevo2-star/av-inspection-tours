import { NextResponse } from "next/server";

/**
 * TEMPORARY diagnostic route -- not part of the real app, added only to see the exact Hyperdrive
 * connection string reaching postgres.js without needing `wrangler tail` (unreliable over this network
 * right now). Redacts the password before returning anything. Delete this file once the live Hyperdrive
 * connection bug is understood.
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

export async function GET() {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = getCloudflareContext();
    const hyperdrive = (env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
    if (!hyperdrive?.connectionString) {
      return NextResponse.json({ error: "no HYPERDRIVE binding" });
    }
    const raw = hyperdrive.connectionString;
    const url = new URL(raw);
    const stripped = new URL(raw);
    stripped.searchParams.delete("sslmode");
    stripped.searchParams.delete("channel_binding");
    return NextResponse.json({
      raw: redact(raw),
      rawParams: Object.fromEntries(url.searchParams.entries()),
      stripped: redact(stripped.toString()),
      strippedParams: Object.fromEntries(stripped.searchParams.entries()),
      hostname: url.hostname,
      port: url.port,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err), stack: err instanceof Error ? err.stack : undefined });
  }
}
