import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { JSON_SYNC_HANDLERS } from "../../../../lib/server/sync-entities";
import { FILE_SYNC_HANDLERS } from "../../../../lib/server/file-sync-entities";
import { ensureDbReady } from "../../../../lib/server/ensure-db-ready";

/**
 * The server side of packages/sync-engine's SyncTransport (see apps/web/lib/sync/http-transport.ts for
 * the client that calls this). One dynamic route for every SyncEntityType.
 *
 * Idempotent by design: every upsert is `INSERT ... ON CONFLICT (id) DO UPDATE`, keyed by the client's
 * own UUID — a retried "create" of an already-confirmed row is a safe no-op, never a duplicate
 * (OFFLINE_SYNC.md "duplicate upload").
 *
 * Status codes matter to the client's retry logic (packages/sync-engine): 400 = bad payload, treated as
 * non-retriable (retrying the exact same bytes won't help); anything else = treated as transient/retriable.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ entityType: string }> }) {
  const params = await props.params;
  const { entityType } = params;

  try {
    await ensureDbReady();

    const handler = JSON_SYNC_HANDLERS[entityType];
    if (!handler) {
      return NextResponse.json({ error: `Unknown sync entity type: ${entityType}` }, { status: 400 });
    }

    const body = await request.json();
    await handler.upsert(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleUpsertError(entityType, err);
  }
}

/**
 * Photo/AudioChunk (spec §18 — audio/photos never inline through the JSON path). Real-device testing
 * found `multipart/form-data` unreliable specifically through a Cloudflare quick tunnel — the exact same
 * request succeeded direct-to-localhost but failed in transit with "no boundary found in multipart body"
 * (an undici/proxy interaction, not pinned down further). Rather than chase that, the file goes as a raw
 * request body instead — no multipart parsing at all, which sidesteps the whole problem and is simpler:
 * `Content-Type` is the file's real mime type, and `?meta=<url-encoded JSON>` carries the entity fields.
 */
export async function PUT(request: NextRequest, props: { params: Promise<{ entityType: string }> }) {
  const params = await props.params;
  const { entityType } = params;

  try {
    await ensureDbReady();

    const handler = FILE_SYNC_HANDLERS[entityType];
    if (!handler) {
      return NextResponse.json({ error: `Unknown or non-file sync entity type: ${entityType}` }, { status: 400 });
    }

    const metaRaw = request.nextUrl.searchParams.get("meta");
    if (!metaRaw) {
      return NextResponse.json({ error: "PUT request needs a ?meta=<url-encoded JSON> query parameter" }, { status: 400 });
    }

    const contentType = request.headers.get("content-type") ?? "application/octet-stream";
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length === 0) {
      return NextResponse.json({ error: "Empty request body" }, { status: 400 });
    }

    await handler.upsert(JSON.parse(metaRaw), bytes, contentType);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleUpsertError(entityType, err);
  }
}

function handleUpsertError(entityType: string, err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "Invalid payload", details: err.issues }, { status: 400 });
  }
  console.error(`[sync] ${entityType} upsert failed:`, err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
