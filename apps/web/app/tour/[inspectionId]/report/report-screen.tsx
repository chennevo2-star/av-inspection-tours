"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { InspectionReportData } from "@av-inspection/report-generator";
import { buildInspectionReportDocument, packToBlob } from "@av-inspection/report-generator";
import { assembleReportData } from "../../../../lib/report/assemble-report-data";
import { saveGeneratedFile } from "../../../../lib/report/save-file";
import { useSpeechDictation } from "../../../../lib/recording/use-speech-dictation";
import { useMounted } from "../../../../lib/hooks/use-mounted";
import { ReportTaskRows } from "./report-task-rows";
import styles from "./report-screen.module.css";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

function reportFileName(data: InspectionReportData, extension: string): string {
  // Strip characters that are illegal in a Windows filename (OneDrive on this user's machine runs on
  // Windows) -- ':' in particular would otherwise show up from a literal "–" date separator elsewhere.
  const safeProject = data.projectName.replace(/[\\/:*?"<>|]/g, " ").trim();
  return `סיור פיקוח עליון - ${safeProject} - ${data.inspectionDate}.${extension}`;
}

/**
 * "הפק דו״ח" preview/edit screen (this session's user request): loads the real tour data once into a
 * local draft, lets the user adjust the free-text "כללי"/"סיכום" fields and the task table (edit text,
 * reorder via long-press, delete a row) before actually producing a file, then exports to Word or PDF
 * and saves it via the user's own folder picker where the browser supports one. Nothing here is written
 * back to IndexedDB -- this is a print-time view of the data, not a second copy of the tour's records.
 */
export function ReportScreen({ inspectionId }: { inspectionId: string }) {
  const mounted = useMounted();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [data, setData] = useState<InspectionReportData | null>(null);
  const [exporting, setExporting] = useState<"docx" | "pdf" | "xlsx" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    setLoad({ status: "loading" });
    void assembleReportData(inspectionId)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoad({ status: "ready" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoad({ status: "error", message: err instanceof Error ? err.message : "שגיאה בטעינת נתוני הדו״ח." });
      });
    return () => {
      cancelled = true;
    };
  }, [mounted, inspectionId]);

  function editGeneralText(value: string) {
    setData((current) => current && { ...current, generalText: value });
  }
  function appendGeneralText(text: string) {
    setData((current) => current && { ...current, generalText: current.generalText ? `${current.generalText} ${text}` : text });
  }
  function editSummaryText(value: string) {
    setData((current) => current && { ...current, summaryText: value });
  }
  function appendSummaryText(text: string) {
    setData((current) => current && { ...current, summaryText: current.summaryText ? `${current.summaryText} ${text}` : text });
  }

  function editTask(id: string, patch: Partial<InspectionReportData["tasks"][number]>) {
    setData((current) => current && { ...current, tasks: current.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  }
  function reorderTask(draggedId: string, targetId: string) {
    setData((current) => {
      if (!current) return current;
      const fromIndex = current.tasks.findIndex((t) => t.id === draggedId);
      const toIndex = current.tasks.findIndex((t) => t.id === targetId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return current;
      const tasks = [...current.tasks];
      // Non-null: fromIndex was just confirmed in-bounds above, so splice(fromIndex, 1) always removes
      // exactly one real element -- this isn't an unchecked-access guess, it's already been checked.
      const moved = tasks.splice(fromIndex, 1)[0]!;
      tasks.splice(toIndex, 0, moved);
      return { ...current, tasks };
    });
  }
  function deleteTask(id: string) {
    setData((current) => current && { ...current, tasks: current.tasks.filter((t) => t.id !== id) });
  }

  async function handleExport(format: "docx" | "pdf" | "xlsx") {
    if (!data) return;
    setExporting(format);
    setExportError(null);
    setExportSuccess(null);
    try {
      if (format === "docx") {
        const docxBlob = await packToBlob(buildInspectionReportDocument(data));
        const result = await saveGeneratedFile(docxBlob, reportFileName(data, "docx"), DOCX_MIME, "docx");
        if (result.method !== "cancelled") setExportSuccess(successMessage(result.method));
        return;
      }

      if (format === "pdf") {
        // JSON InspectionReportData body (not raw DOCX bytes) -- this is what actually gets the pure-JS
        // engine by default (build-pdf.ts, no LibreOffice/Office install needed on the server); the route
        // still accepts raw DOCX bytes too, but only to keep an older caller shape working, and that path
        // is LibreOffice-only unconditionally (see the route's own comment) -- sending JSON is what makes
        // this button actually benefit from the new engine instead of silently keeping the old one.
        const res = await fetch("/api/report/docx-to-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `שגיאה ביצירת PDF (קוד ${res.status}).`);
        }
        const pdfBlob = await res.blob();
        const result = await saveGeneratedFile(pdfBlob, reportFileName(data, "pdf"), "application/pdf", "pdf");
        if (result.method !== "cancelled") setExportSuccess(successMessage(result.method));
        return;
      }

      const res = await fetch("/api/report/xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `שגיאה ביצירת Excel (קוד ${res.status}).`);
      }
      const xlsxBlob = await res.blob();
      const result = await saveGeneratedFile(
        xlsxBlob,
        reportFileName(data, "xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsx"
      );
      if (result.method !== "cancelled") setExportSuccess(successMessage(result.method));
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "שגיאה לא צפויה בייצוא הדו״ח.");
    } finally {
      setExporting(null);
    }
  }

  if (load.status === "loading" || !data) {
    return (
      <main className={styles.wrap}>
        <p className={styles.hint}>טוען נתוני דו״ח…</p>
      </main>
    );
  }

  if (load.status === "error") {
    return (
      <main className={styles.wrap}>
        <p className={styles.hint}>{load.message}</p>
      </main>
    );
  }

  const dateLabel = new Date(data.inspectionDate).toLocaleDateString("he-IL", { year: "numeric", month: "long", day: "numeric" });

  return (
    <main className={styles.wrap}>
      <header className={styles.header}>
        <Link href={`/tour/${inspectionId}`} className={styles.backLink}>
          ← חזרה לסיור
        </Link>
        <h1 className={styles.title}>
          סיור פיקוח עליון מולטימדיה – {data.projectName} – {dateLabel}
        </h1>
      </header>

      <div className={styles.metaBlock}>
        <div>
          <strong>תאריך:</strong> {dateLabel}
        </div>
        <div>
          <strong>משתתפים:</strong> {data.participants.length > 0 ? data.participants.join(", ") : "לא צוינו"}
        </div>
        <div>
          <strong>נערך על ידי:</strong> {data.officeName}
        </div>
        {data.logo === null ? <div className={styles.logoWarning}>⚠ לוגו המשרד עדיין לא הוגדר במערכת — הדו״ח יופק בלעדיו.</div> : null}
      </div>

      <section className={styles.section}>
        <DictationField label="כללי" value={data.generalText} onChange={editGeneralText} onDictate={appendGeneralText} placeholder="מטרת הסיור, הקשר כללי…" />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          משימות <span className={styles.sectionCount}>({data.tasks.length})</span>
        </h2>
        <ReportTaskRows tasks={data.tasks} onEdit={editTask} onReorder={reorderTask} onDelete={deleteTask} />
      </section>

      <section className={styles.section}>
        <DictationField label="סיכום" value={data.summaryText} onChange={editSummaryText} onDictate={appendSummaryText} placeholder="סיכום הסיור, נקודות להמשך…" />
      </section>

      <section className={styles.exportSection}>
        <div className={styles.exportButtons}>
          <button type="button" className={styles.exportButton} disabled={exporting !== null} onClick={() => void handleExport("docx")}>
            {exporting === "docx" ? "מייצא…" : "📄 ייצוא כ-Word"}
          </button>
          <button
            type="button"
            className={`${styles.exportButton} ${styles.exportButtonSecondary}`}
            disabled={exporting !== null}
            onClick={() => void handleExport("pdf")}
          >
            {exporting === "pdf" ? "יוצר…" : "📑 ייצוא כ-PDF"}
          </button>
          <button
            type="button"
            className={`${styles.exportButton} ${styles.exportButtonSecondary}`}
            disabled={exporting !== null}
            onClick={() => void handleExport("xlsx")}
          >
            {exporting === "xlsx" ? "יוצר…" : "📊 ייצוא כ-Excel"}
          </button>
        </div>
        {exportSuccess ? <p className={`${styles.exportStatus} ${styles.exportStatusSuccess}`}>{exportSuccess}</p> : null}
        {exportError ? <p className={`${styles.exportStatus} ${styles.exportStatusError}`}>{exportError}</p> : null}
      </section>
    </main>
  );
}

function successMessage(method: "picker" | "download"): string {
  return method === "picker"
    ? "הדו״ח נשמר בהצלחה במיקום שנבחר."
    : "הדו״ח הורד לתיקיית ההורדות של הדפדפן — ניתן להעביר אותו לתיקיית ה-OneDrive.";
}

function DictationField({
  label,
  value,
  onChange,
  onDictate,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onDictate: (text: string) => void;
  placeholder: string;
}) {
  const dictation = useSpeechDictation(onDictate);
  return (
    <div>
      <h2 className={styles.sectionTitle}>{label}</h2>
      <textarea className={styles.textArea} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <div className={styles.dictateRow}>
        {!dictation.checked ? null : dictation.status === "unsupported" ? (
          <span className={styles.dictateHint}>הכתבה קולית לא נתמכת בדפדפן זה — אפשר להקליד.</span>
        ) : (
          <button
            type="button"
            className={`${styles.dictateButton} ${dictation.status === "listening" ? styles.dictateButtonListening : ""}`}
            onClick={dictation.status === "listening" ? dictation.stop : dictation.start}
          >
            🎙️ {dictation.status === "listening" ? "מקשיב… (לחץ לעצירה)" : "הכתב בקול"}
          </button>
        )}
      </div>
      {dictation.errorMessage ? <p className={styles.dictateHint}>{dictation.errorMessage}</p> : null}
    </div>
  );
}
