"use client";

import { useRef, useState } from "react";
import { createFloor } from "../../../lib/db/floors";
import { extractFloorsFromPdf, extractFloorsFromPdfBytes, type DetectedFloor } from "../../../lib/floor-import/parse-single-line-pdf";
import {
  FilePickerCancelledError,
  downloadPickedFile,
  openOneDriveFilePicker,
} from "../../../lib/graph-picker/open-onedrive-file-picker";
import styles from "./floor-import-modal.module.css";

// Same two env vars the OneDrive picker's own resolveOneDriveSiteUrl() needs (it derives the OneDrive URL
// itself via Graph, so unlike the SharePoint folder picker this doesn't also need NEXT_PUBLIC_MS_GRAPH_SITE_URL).
const ONEDRIVE_PICKER_CONFIGURED =
  !!process.env.NEXT_PUBLIC_MS_GRAPH_CLIENT_ID && !!process.env.NEXT_PUBLIC_MS_GRAPH_TENANT_ID;

function defaultDisplayName(floor: DetectedFloor): string {
  return floor.name ? `${floor.label} - ${floor.name}` : floor.label;
}

interface EditableRow {
  floor: DetectedFloor;
  checked: boolean;
  name: string;
}

type LoadState =
  | { status: "idle" }
  | { status: "parsing" }
  | { status: "error"; message: string }
  | { status: "ready" };

/**
 * "ייבוא קומות מסכמה חד קווית" (user request): pick a single-line riser-diagram PDF, extract the floor
 * list from it (parse-single-line-pdf.ts), let the user review/uncheck/rename before anything is written,
 * then create the checked ones as real Floor rows. Entirely client-side -- the PDF itself is never
 * uploaded or stored, it only ever exists in this browser tab for the few seconds it takes to parse it.
 */
export function FloorImportModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function applyDetectedFloors(floors: DetectedFloor[]) {
    if (floors.length === 0) {
      setLoad({
        status: "error",
        message: "לא זוהתה אף קומה בקובץ. הפורמט חייב להיות תואם לסכמה חד-קווית עם מספרי קומות בצד שמאל.",
      });
      return;
    }
    setRows(floors.map((floor) => ({ floor, checked: true, name: defaultDisplayName(floor) })));
    setLoad({ status: "ready" });
  }

  async function handleFileChosen(file: File) {
    setLoad({ status: "parsing" });
    try {
      applyDetectedFloors(await extractFloorsFromPdf(file));
    } catch (err) {
      setLoad({
        status: "error",
        message: err instanceof Error ? `שגיאה בקריאת הקובץ: ${err.message}` : "שגיאה לא צפויה בקריאת הקובץ.",
      });
    }
  }

  async function handleOneDrivePick() {
    setLoad({ status: "parsing" });
    try {
      const picked = await openOneDriveFilePicker(["pdf"]);
      const bytes = await downloadPickedFile(picked);
      applyDetectedFloors(await extractFloorsFromPdfBytes(new Uint8Array(bytes)));
    } catch (err) {
      if (err instanceof FilePickerCancelledError) {
        setLoad({ status: "idle" });
        return;
      }
      setLoad({
        status: "error",
        message: err instanceof Error ? `שגיאה בייבוא מ-OneDrive: ${err.message}` : "שגיאה לא צפויה בייבוא מ-OneDrive.",
      });
    }
  }

  function toggleRow(index: number) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, checked: !row.checked } : row)));
  }

  function renameRow(index: number, name: string) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, name } : row)));
  }

  async function handleConfirm() {
    const selected = rows.filter((row) => row.checked && row.name.trim());
    if (selected.length === 0) return;
    setImporting(true);
    try {
      // Sequential (not Promise.all) and in the diagram's own top-to-bottom order, so the new floors'
      // auto-assigned sortOrder (createFloor(), which counts existing rows) comes out matching the
      // building's real layout instead of racing to an arbitrary order.
      for (const row of selected) {
        await createFloor(projectId, row.name.trim(), row.floor.floorNumber);
      }
      onClose();
    } finally {
      setImporting(false);
    }
  }

  const checkedCount = rows.filter((row) => row.checked).length;

  return (
    <div className={styles.overlay}>
      <header className={styles.header}>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="סגור">
          ✕
        </button>
        <h1 className={styles.title}>ייבוא קומות מסכמה חד קווית</h1>
      </header>

      <div className={styles.body}>
        {load.status === "idle" || load.status === "error" ? (
          <>
            <p className={styles.hint}>
              בחר קובץ PDF של סכמה חד קווית — הקומות שמופיעות בצד שמאל של הסכמה (ומספרי הקומה שלהן) ייקראו
              אוטומטית. הקובץ עצמו לא נשמר בשום מקום, רק הקומות שתאשר.
            </p>
            <button type="button" className={styles.pickButton} onClick={() => fileInputRef.current?.click()}>
              📄 בחר קובץ PDF מהמכשיר…
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ""; // allow re-selecting the same file after a failed attempt
                if (file) void handleFileChosen(file);
              }}
            />
            {ONEDRIVE_PICKER_CONFIGURED ? (
              <button
                type="button"
                className={styles.pickButton}
                style={{ marginTop: 10 }}
                onClick={() => void handleOneDrivePick()}
              >
                📤 ייבוא מ-OneDrive…
              </button>
            ) : (
              <p className={styles.hint} style={{ marginTop: 10 }}>
                ייבוא ישירות מ-OneDrive עדיין לא זמין — חסרה הגדרה חד-פעמית של Microsoft Entra (ראה
                apps/web/lib/graph-picker/msal-client.ts). אפשר להשתמש בינתיים בבחירת קובץ מהמכשיר למעלה —
                אם ה-OneDrive מסונכרן למכשיר, הקבצים שלו יופיעו שם כרגיל.
              </p>
            )}
            {load.status === "error" ? <p className={styles.error}>{load.message}</p> : null}
          </>
        ) : null}

        {load.status === "parsing" ? <p className={styles.hint}>קורא את הקובץ…</p> : null}

        {load.status === "ready" ? (
          <>
            <p className={styles.hint}>
              נמצאו {rows.length} קומות. אפשר לבטל סימון קומות שלא רוצים לייבא, ולערוך את השם לפני האישור.
            </p>
            <ul className={styles.list}>
              {rows.map((row, index) => (
                <li key={`${row.floor.label}-${index}`} className={styles.row}>
                  <input type="checkbox" checked={row.checked} onChange={() => toggleRow(index)} />
                  <span className={styles.rowLabel}>{row.floor.label}</span>
                  <input
                    className={styles.rowNameInput}
                    value={row.name}
                    onChange={(e) => renameRow(index, e.target.value)}
                    aria-label={`שם קומה ${row.floor.label}`}
                  />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      {load.status === "ready" ? (
        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.confirmButton}
            onClick={() => void handleConfirm()}
            disabled={checkedCount === 0 || importing}
          >
            {importing ? "מייבא…" : `ייבא ${checkedCount} קומות`}
          </button>
        </footer>
      ) : null}
    </div>
  );
}
