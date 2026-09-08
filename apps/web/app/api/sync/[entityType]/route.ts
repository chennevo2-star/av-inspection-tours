import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { JSON_SYNC_HANDLERS } from "../../../../lib/server/sync-entities";
import { FILE_SYNC_HANDLERS } from "../../../../lib/server/file-sync-entities";
import { ensureDbReady } from "../../../../lib/server/ensure-db-ready";

/**
 * The server side of packages/sync-engine's SyncTransport (see apps/web/lib/sync/http-transport.ts for
 * the client that calls this). One dynamic route for every SyncEntityType — JSON body for plain
 * entities, `multipart/form-data` (a `meta` JSON field + a `file` field) for Photo/AudioChunk.
 *
 * Idempotent by design: every upsert is `INSERT ... ON CONFLICT (id) DO UPDATE`, keyed by the client's
 * own UUID — a retried "create" of an already-confirmed row is a safe no-op, never a duplicate
 * (OFFLINE_SYNC.md "duplicate upload").
 *
 * Status codes matter to the client's retry logic (packages/sync-engine): 400 = bad payload, treated as
 * non-retriable (retrying the exact same bytes won't help); anything else = treated as transient/retriable.
 */
export async function POST(request: NextRequest, { params }: { params: { entityType: string } }) {
  const { entityType } = params;

  try {
    await ensureDbReady();
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const handler = FILE_SYNC_HANDLERS[entityType];
      if (!handler) {
        return NextResponse.json({ error: `Unknown or non-file sync entity type: ${entityType}` }, { status: 400 });
      }

      const formData = await request.formData();
      const metaRaw = formData.get("meta");
      const file = formData.get("file");
      if (typeof metaRaw !== "string" || !(file instanceof File)) {
        return NextResponse.json(
          { error: "multipart request needs a 'meta' (JSON string) field and a 'file' field" },
          { status: 400 }
        );
      }

      await handler.upsert(JSON.parse(metaRaw), file);
      return NextResponse.json({ ok: true });
    }

    const handler = JSON_SYNC_HANDLERS[entityType];
    if (!handler) {
      return NextResponse.json({ error: `Unknown sync entity type: ${entityType}` }, { status: 400 });
    }

    const body = await request.json();
    await handler.upsert(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid payload", details: err.issues }, { status: 400 });
    }
    console.error(`[sync] ${entityType} upsert failed:`, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
