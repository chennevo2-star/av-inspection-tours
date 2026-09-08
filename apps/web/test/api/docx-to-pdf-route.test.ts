import { describe, expect, it } from "vitest";
import { buildInspectionReportDocument, packToBuffer } from "@av-inspection/report-generator";
import type { InspectionReportData } from "@av-inspection/report-generator";

// Real HTTP round-trip against the actual running dev server (localhost:3000) — not a mocked handler.
// This is the same pattern already used in this project for the Audio/AudioChunk sync fix: a route
// that only "looks" wired up isn't trustworthy until it's hit over real HTTP (spec's "no Mock Success"
// rule). Skipped gracefully (not faked) when no dev server is reachable, same as the LibreOffice-gated
// test in packages/report-generator.
const DEV_SERVER_URL = "http://localhost:3000";

async function devServerReachable(): Promise<boolean> {
  try {
    const res = await fetch(DEV_SERVER_URL, { signal: AbortSignal.timeout(3000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

const serverUp = await devServerReachable();

function sampleData(): InspectionReportData {
  return {
    officeName: "ל.שחר",
    logo: null,
    projectName: "Biocatch",
    projectAddress: "רחוב הברזל 3, תל אביב",
    inspectionNumber: 12,
    inspectionDate: "2026-09-08",
    participants: ["דני"],
    generalText: "בדיקת מסלול ה-API האמיתי מקצה לקצה.",
    tasks: [],
    summaryText: "בדיקה.",
  };
}

describe.skipIf(!serverUp)("POST /api/report/docx-to-pdf — real route on the real dev server", () => {
  it(
    "converts a real generated DOCX to a real PDF over HTTP",
    async () => {
      const doc = buildInspectionReportDocument(sampleData());
      const docxBuffer = await packToBuffer(doc);

      const res = await fetch(`${DEV_SERVER_URL}/api/report/docx-to-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
        body: docxBuffer,
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");

      const pdfBytes = new Uint8Array(await res.arrayBuffer());
      expect(Buffer.from(pdfBytes.subarray(0, 4)).toString("latin1")).toBe("%PDF");
      expect(pdfBytes.length).toBeGreaterThan(1000);
    },
    30_000
  );

  it("returns a clear 400, not a crash, for an empty body", async () => {
    const res = await fetch(`${DEV_SERVER_URL}/api/report/docx-to-pdf`, {
      method: "POST",
      body: new Uint8Array(0),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});
