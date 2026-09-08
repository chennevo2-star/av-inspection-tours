import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

/**
 * DOCX → PDF, server-side, via LibreOffice headless (ADR-004 — PDF is always derived from the exact
 * DOCX, never generated independently, so the two can never visually diverge). Real, and only as
 * reliable as LibreOffice actually being installed on this machine — see ADR-007/ADR-004 for the
 * install story. Returns a clear, honest error (not a fake/empty PDF) if it isn't.
 */
export async function POST(request: NextRequest) {
  const sofficePath = process.env.SOFFICE_PATH ?? "C:\\Program Files\\LibreOffice\\program\\soffice.exe";

  const docxBytes = new Uint8Array(await request.arrayBuffer());
  if (docxBytes.length === 0) {
    return NextResponse.json({ error: "Empty request body — expected DOCX bytes" }, { status: 400 });
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "av-inspection-docx2pdf-"));
  const docxPath = path.join(workDir, "report.docx");

  try {
    await writeFile(docxPath, docxBytes);

    await execFileAsync(sofficePath, ["--headless", "--convert-to", "pdf", "--outdir", workDir, docxPath], {
      timeout: 60_000,
    });

    const pdfPath = path.join(workDir, "report.pdf");
    const pdfBytes = await readFile(pdfPath);

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: { "Content-Type": "application/pdf" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isMissingBinary = message.includes("ENOENT");
    console.error("[report] DOCX→PDF conversion failed:", err);
    return NextResponse.json(
      {
        error: isMissingBinary
          ? `LibreOffice לא נמצא בנתיב ${sofficePath}. ייצוא PDF דורש LibreOffice מותקן בשרת.`
          : `המרת PDF נכשלה: ${message}`,
      },
      { status: 500 }
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
