import { NextRequest, NextResponse } from "next/server";
import { appSettings, getDb } from "@av-inspection/db";
import { eq } from "drizzle-orm";
import { GraphAuth, STORAGE_ROOT_FOLDER_SETTING_KEY } from "@av-inspection/storage";
import { ensureDbReady } from "../../../../lib/server/ensure-db-ready";

/**
 * Server side of the storage settings screen's SharePoint folder picker (apps/web/app/settings/
 * storage-folder). The picker itself runs client-side under the SIGNED-IN USER's own delegated auth
 * (apps/web/lib/graph-picker) and only ever returns a bare `{driveId, itemId}` -- resolving that into a
 * real drive-root-relative path (what `packages/storage`'s `rootFolderOverrideProvider` actually needs)
 * requires its own Graph call, done here with the app's EXISTING app-only credentials
 * (packages/storage/src/graph-auth.ts), not the user's delegated token, which is intentionally read-only
 * and never sent to this server at all.
 */

interface GraphDriveItem {
  id: string;
  name: string;
  webUrl: string;
  parentReference?: { path?: string; driveId?: string };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function resolveFolderPath(driveId: string, itemId: string): Promise<{ path: string; webUrl: string }> {
  const auth = new GraphAuth({
    tenantId: requireEnv("MS_GRAPH_TENANT_ID"),
    clientId: requireEnv("MS_GRAPH_CLIENT_ID"),
    clientSecret: requireEnv("MS_GRAPH_CLIENT_SECRET"),
  });
  const token = await auth.getAccessToken();

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}?$select=id,name,webUrl,parentReference`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Graph lookup failed (${response.status}): ${text}`);
  }
  const item = (await response.json()) as GraphDriveItem;

  // `parentReference.path` comes back in the form "/drives/{driveId}/root:/a/b/c" (odata path
  // addressing) -- everything after the literal "root:" is the drive-root-relative parent path; the
  // item's own name is appended to get the full folder path, matching exactly what
  // `MsGraphStorage`'s own `rootFolder`-relative path construction expects (see its own top comment).
  const parentPath = item.parentReference?.path ?? "";
  const marker = "root:";
  const markerIndex = parentPath.indexOf(marker);
  const relativeParent = markerIndex === -1 ? "" : decodeURIComponent(parentPath.slice(markerIndex + marker.length));
  const trimmedParent = relativeParent.replace(/^\/+|\/+$/g, "");
  const path = trimmedParent ? `${trimmedParent}/${item.name}` : item.name;

  return { path, webUrl: item.webUrl };
}

export async function GET() {
  try {
    await ensureDbReady();
    const rows = await getDb()
      .select({ value: appSettings.value, updatedAt: appSettings.updatedAt })
      .from(appSettings)
      .where(eq(appSettings.key, STORAGE_ROOT_FOLDER_SETTING_KEY))
      .limit(1);
    const row = rows[0];
    return NextResponse.json({
      path: typeof row?.value === "string" ? row.value : null,
      updatedAt: row?.updatedAt ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureDbReady();
    const body: unknown = await request.json().catch(() => null);
    const driveId = (body as { driveId?: unknown })?.driveId;
    const itemId = (body as { itemId?: unknown })?.itemId;
    if (typeof driveId !== "string" || !driveId || typeof itemId !== "string" || !itemId) {
      return NextResponse.json({ error: "Body must be { driveId: string, itemId: string }" }, { status: 400 });
    }

    const { path, webUrl } = await resolveFolderPath(driveId, itemId);

    const db = getDb();
    await db
      .insert(appSettings)
      .values({ key: STORAGE_ROOT_FOLDER_SETTING_KEY, value: path })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: path, updatedAt: new Date() } });

    return NextResponse.json({ path, webUrl });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await ensureDbReady();
    await getDb().delete(appSettings).where(eq(appSettings.key, STORAGE_ROOT_FOLDER_SETTING_KEY));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
