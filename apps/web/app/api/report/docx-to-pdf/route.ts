import { NextRequest, NextResponse } from "next/server";
import {
  buildInspectionReportDocument,
  buildInspectionReportPdf,
  packToBuffer,
  packPdfToBuffer,
  deserializeReportDataFromWire,
} from "@av-inspection/report-generator";
import type { WireInspectionReportData } from "@av-inspection/report-generator";
import { toArrayBuffer } from "../to-array-buffer";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * LibreOffice's default headless invocation shares one per-user profile and its lock file across every
 * concurrent `soffice` process — a real bug found here (two conversions started close together, e.g. a
 * retry or two browser tabs, or this route running alongside packages/report-generator's own PDF test)
 * fail with a plain "Command failed" because the second process can't acquire that lock. `-env:
 * UserInstallation=<unique dir>` gives each invocation its own isolated profile so concurrent
 * conversions can't collide — the standard fix for this well-known LibreOffice headless limitation.
 */
function toFileUri(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

/**
 * Converts real DOCX bytes to a real PDF via a real installed LibreOffice binary. Kept ONLY as an
 * explicit, clearly-labeled fallback now (`PDF_ENGINE=libreoffice`) — a safety net during the rollout of
 * the new pure-JS engine below, not a silently-parallel second code path. The company's spec now rules
 * out depending on any locally-installed software for PDF generation (see build-pdf.ts's own top comment
 * for the full research behind the replacement), so this is no longer the default, but real production
 * environments sometimes need a fallback while the new engine proves itself — hence "kept", not deleted.
 */
async function convertDocxToPdfViaLibreOffice(docxBytes: Uint8Array): Promise<Uint8Array> {
  // Imported lazily, only when this LibreOffice branch actually runs: `node:child_process` (and, less
  // critically, `node:fs`/`node:os`) has no real implementation on Cloudflare Workers -- there's no OS
  // process model in that isolate-based runtime at all, so this isn't a compat gap that might get fixed,
  // it's a hard platform limitation. A real bug was hit here from a top-level `import { execFile } from
  // "node:child_process"` (module-load-time, evaluated the moment Next.js dispatches ANY request to this
  // route file, regardless of which branch actually runs): it broke the route entirely on the Workers/edge
  // deploy (apps/web/wrangler.jsonc) even for the pure-JS default engine below, which never needs
  // LibreOffice at all. Lazy imports mean this file loads cleanly on Workers as long as PDF_ENGINE stays
  // unset there (the documented default) -- this fallback keeps working unmodified on the Container/Node
  // deploy path, which is the only place it's ever actually invoked.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { default: path } = await import("node:path");
  const execFileAsync = promisify(execFile);

  const sofficePath = process.env.SOFFICE_PATH ?? "C:\\Program Files\\LibreOffice\\program\\soffice.exe";
  const workDir = await mkdtemp(path.join(tmpdir(), "av-inspection-docx2pdf-"));
  const docxPath = path.join(workDir, "report.docx");
  const profileDir = path.join(workDir, "lo-profile");

  try {
    await writeFile(docxPath, docxBytes);
    await execFileAsync(
      sofficePath,
      [`-env:UserInstallation=${toFileUri(profileDir)}`, "--headless", "--convert-to", "pdf", "--outdir", workDir, docxPath],
      { timeout: 60_000 }
    );
    const pdfPath = path.join(workDir, "report.pdf");
    return await readFile(pdfPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Loose but real shape check -- this route has no existing zod schema for InspectionReportData to
 * reuse, and introducing one is out of this change's scope; this catches the obviously-wrong-body case
 * (missing/malformed JSON) with an honest 400 rather than crashing deep inside the PDF/DOCX builders. */
function isLikelyInspectionReportData(value: unknown): value is WireInspectionReportData {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as WireInspectionReportData).tasks) &&
    typeof (value as WireInspectionReportData).projectName === "string"
  );
}

/**
 * PDF generation endpoint. Two request shapes are accepted, for two different reasons:
 *
 * 1. `Content-Type: <docx mime>`, raw DOCX bytes as the body — the shape the CURRENTLY SHIPPED client
 *    (apps/web/app/tour/[inspectionId]/report/report-screen.tsx) already sends; that file lives outside
 *    this change's allowed scope, so it hasn't been updated to send the new contract below. Raw DOCX
 *    bytes can only honestly be handled one way here: LibreOffice conversion. This branch always uses
 *    it, regardless of PDF_ENGINE — there's no InspectionReportData in a DOCX-bytes body to hand the new
 *    engine. Updating report-screen.tsx to send shape (2) instead (so it actually benefits from the new
 *    no-external-binary default) is a real, small follow-up outside this file's own scope — see the
 *    final report for this task.
 * 2. `Content-Type: application/json`, an `InspectionReportData` body — the new, primary contract.
 *    Defaults to the pure-JS engine (build-pdf.ts); set `PDF_ENGINE=libreoffice` to instead build the
 *    DOCX server-side from the same data and convert THAT via LibreOffice (still real, still never a
 *    faked/independently-diverging PDF, just via the legacy path).
 *
 * Preserves the route's original honest-error behavior either way: never returns a fake/empty PDF.
 */
export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  const useLibreOffice = process.env.PDF_ENGINE === "libreoffice";

  try {
    if (contentType.includes(DOCX_MIME)) {
      const docxBytes = new Uint8Array(await request.arrayBuffer());
      if (docxBytes.length === 0) {
        return NextResponse.json({ error: "Empty request body — expected DOCX bytes" }, { status: 400 });
      }
      const pdfBytes = await convertDocxToPdfViaLibreOffice(docxBytes);
      return new NextResponse(toArrayBuffer(pdfBytes), { status: 200, headers: { "Content-Type": "application/pdf" } });
    }

    const body: unknown = await request.json().catch(() => null);
    if (!isLikelyInspectionReportData(body)) {
      return NextResponse.json(
        { error: "גוף הבקשה חייב להיות מסמך דו״ח (InspectionReportData) בפורמט JSON, או קובץ DOCX." },
        { status: 400 }
      );
    }
    // Reverses serializeReportDataForWire's base64 encoding of every ReportPhoto's bytes -- see
    // wire-format.ts's own doc comment for the real silent-data-loss bug this closes.
    const data = deserializeReportDataFromWire(body);

    if (useLibreOffice) {
      const docxBytes = await packToBuffer(buildInspectionReportDocument(data));
      const pdfBytes = await convertDocxToPdfViaLibreOffice(docxBytes);
      return new NextResponse(toArrayBuffer(pdfBytes), { status: 200, headers: { "Content-Type": "application/pdf" } });
    }

    const pdfDoc = await buildInspectionReportPdf(data);
    const pdfBytes = await packPdfToBuffer(pdfDoc);
    return new NextResponse(toArrayBuffer(pdfBytes), { status: 200, headers: { "Content-Type": "application/pdf" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isMissingBinary = message.includes("ENOENT");
    console.error("[report] PDF generation failed:", err);
    return NextResponse.json(
      {
        error: isMissingBinary
          ? `LibreOffice לא נמצא בשרת (PDF_ENGINE=libreoffice דורש soffice מותקן).`
          : `יצירת PDF נכשלה: ${message}`,
      },
      { status: 500 }
    );
  }
}
