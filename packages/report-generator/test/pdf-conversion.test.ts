import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildInspectionReportDocument, packToBuffer } from "../src/index.js";
import type { InspectionReportData } from "../src/types.js";

const execFileAsync = promisify(execFile);

// Mirrors the default in apps/web/app/api/report/docx-to-pdf/route.ts — this test exercises the exact
// same real LibreOffice binary that route will shell out to, not a stand-in for it.
const SOFFICE_PATH = process.env.SOFFICE_PATH ?? "C:\\Program Files\\LibreOffice\\program\\soffice.exe";

async function sofficeAvailable(): Promise<boolean> {
  try {
    await access(SOFFICE_PATH);
    return true;
  } catch {
    return false;
  }
}

const hasSoffice = await sofficeAvailable();

function sampleData(): InspectionReportData {
  return {
    officeName: "ל.שחר",
    logo: null,
    projectName: "Biocatch",
    projectAddress: "רחוב הברזל 3, תל אביב",
    inspectionNumber: 12,
    inspectionDate: "2026-09-08",
    participants: ["דני", "יוני"],
    generalText: "מטרת הסיור הייתה לבדוק את מערכות ה-AV בקומה 30 לקראת מסירה.",
    tasks: [
      {
        id: "task-1",
        friendlyNumber: 1,
        floorName: "קומה 30",
        roomName: "חדר ישיבות גדול",
        description: "אין חיבור HDMI קווי למסך למרות שהתשתית קיימת.",
        responsibleParty: "סינמה",
        status: "פתוח",
        photos: [],
      },
    ],
    summaryText: "הסיור התנהל כשגרה.",
    inspectorName: "דני כהן",
    inspectorStamp: null,
  };
}

// This is the one genuinely slow, environment-dependent test in the suite: it shells out to a real
// LibreOffice process (ADR-004 — PDF is always derived from the real DOCX via real LibreOffice, never
// faked). Skipped (not mocked) when LibreOffice isn't installed on the machine running the suite —
// per spec's "no Mock Success" rule, honestly skipping is the correct behavior, not silently passing
// a fake conversion.
describe.skipIf(!hasSoffice)("DOCX → PDF via real LibreOffice headless", () => {
  it(
    "converts a real generated report DOCX into a real PDF file",
    async () => {
      const doc = buildInspectionReportDocument(sampleData());
      const docxBuffer = await packToBuffer(doc);

      const workDir = await mkdtemp(path.join(tmpdir(), "av-inspection-pdf-test-"));
      const docxPath = path.join(workDir, "report.docx");
      try {
        await writeFile(docxPath, docxBuffer);

        // -env:UserInstallation=<unique dir>: without it, this concurrent run can collide with the
        // route's own soffice invocation (or a second run of this same test) over LibreOffice's shared
        // default profile lock -- a real bug found and fixed the same way in the actual API route
        // (apps/web/app/api/report/docx-to-pdf/route.ts). Keeping both call sites isolated the same way.
        const profileUri = `file:///${path.join(workDir, "lo-profile").replace(/\\/g, "/")}`;
        await execFileAsync(
          SOFFICE_PATH,
          [`-env:UserInstallation=${profileUri}`, "--headless", "--convert-to", "pdf", "--outdir", workDir, docxPath],
          { timeout: 60_000 }
        );

        const pdfPath = path.join(workDir, "report.pdf");
        const pdfBytes = await readFile(pdfPath);

        // Real PDF magic bytes, not a renamed/empty file.
        expect(pdfBytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
        expect(pdfBytes.length).toBeGreaterThan(1000);
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
    30_000
  );
});
