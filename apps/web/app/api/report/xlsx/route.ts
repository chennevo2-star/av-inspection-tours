import { NextRequest, NextResponse } from "next/server";
import { buildInspectionReportXlsx, packXlsxToBuffer } from "@av-inspection/report-generator";
import type { InspectionReportData } from "@av-inspection/report-generator";
import { toArrayBuffer } from "../to-array-buffer";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Same loose shape check as docx-to-pdf/route.ts -- no existing zod schema for this type to reuse. */
function isLikelyInspectionReportData(value: unknown): value is InspectionReportData {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as InspectionReportData).tasks) &&
    typeof (value as InspectionReportData).projectName === "string"
  );
}

/**
 * XLSX (task table) export endpoint — net new, mirrors docx-to-pdf/route.ts's shape for the new
 * InspectionReportData-JSON contract (there's no legacy caller/compatibility concern here, since this
 * export never existed before). Generation is pure-JS (SheetJS Community Edition, see build-xlsx.ts's
 * own top comment) — no server-side install dependency at all, unlike the old LibreOffice PDF path.
 *
 * NOTE: no UI entry point calls this route yet (report-screen.tsx, where the "ייצוא כ-Word"/"ייצוא
 * כ-PDF" buttons live, is outside this change's allowed file scope) -- see the final report for this
 * task. The route itself is real, wired, and independently testable via build-xlsx.test.ts.
 */
export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json().catch(() => null);
    if (!isLikelyInspectionReportData(body)) {
      return NextResponse.json(
        { error: "גוף הבקשה חייב להיות מסמך דו״ח (InspectionReportData) בפורמט JSON." },
        { status: 400 }
      );
    }

    const workbook = buildInspectionReportXlsx(body);
    const bytes = packXlsxToBuffer(workbook);
    return new NextResponse(toArrayBuffer(bytes), { status: 200, headers: { "Content-Type": XLSX_MIME } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[report] XLSX generation failed:", err);
    return NextResponse.json({ error: `יצירת קובץ Excel נכשלה: ${message}` }, { status: 500 });
  }
}
