import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getLocalFsStorageIfActive } from "@av-inspection/storage";
import { mimeTypeForExtension } from "../../../../lib/server/mime";

/**
 * Serves files for ADR-007's local-filesystem storage fallback. Only active when that backend is in use
 * (no `S3_ENDPOINT` set) — under real S3/MinIO, clients fetch the real presigned URL directly and never
 * hit this route at all. Not real access control (see LocalFsStorage's own comment) — local dev only.
 */
export async function GET(_request: NextRequest, props: { params: Promise<{ key: string[] }> }) {
  const params = await props.params;
  const storage = getLocalFsStorageIfActive();
  if (!storage) {
    return NextResponse.json({ error: "Local file serving is inactive (S3-compatible storage is configured)" }, { status: 404 });
  }

  const key = params.key.join("/");

  try {
    const filePath = storage.resolvePath(key);
    const bytes = await readFile(filePath);
    const ext = key.split(".").pop() ?? "";
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": mimeTypeForExtension(ext),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
