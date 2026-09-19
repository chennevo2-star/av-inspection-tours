"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import type { ContractorBankEntry } from "@av-inspection/shared-types";
import {
  createContractorBankEntry,
  deleteContractorBankEntry,
  listContractorBank,
  updateContractorBankEntry,
} from "../../lib/db/contractor-bank";
import { useMounted } from "../../lib/hooks/use-mounted";
import styles from "./contractor-bank-screen.module.css";

/**
 * "רשימת קבלנים" (session's user request): manage the cross-project contractor bank directly — add, edit,
 * remove. Separate from a project's own קבלנים section (contractors-section.tsx), which now offers this
 * bank as quick-pick options rather than owning the data itself — see ContractorBankEntry's own doc
 * comment in shared-types for how the two relate. Reachable directly from the main menu (user request —
 * moved off the Settings hub, where it first briefly lived).
 */
export function ContractorBankScreen() {
  const mounted = useMounted();
  const [companyName, setCompanyName] = useState("");
  const [field, setField] = useState("");
  const [creating, setCreating] = useState(false);

  const entries = useLiveQuery(
    () => (mounted ? listContractorBank() : Promise.resolve<ContractorBankEntry[]>([])),
    [mounted]
  );

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const name = companyName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createContractorBankEntry({ companyName: name, field: field.trim() || null });
      setCompanyName("");
      setField("");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(entry: ContractorBankEntry) {
    const confirmed = window.confirm(`למחוק את "${entry.companyName}" מבנק הקבלנים? (זה לא מוחק קבלנים שכבר שויכו לפרויקטים)`);
    if (!confirmed) return;
    await deleteContractorBankEntry(entry.id);
  }

  return (
    <main className={styles.main}>
      <Link href="/" className={styles.backLink}>
        ← תפריט ראשי
      </Link>
      <h1 className={styles.title}>רשימת קבלנים</h1>
      <p className={styles.hint}>
        הבנק המשותף לכל הפרויקטים — קבלן שמתווסף כאן (או מתווסף לפרויקט כלשהו) זמין לבחירה מהירה בכל
        פרויקט אחר.
      </p>

      <form className={styles.addForm} onSubmit={handleCreate}>
        <input
          className={styles.input}
          placeholder="שם חברה"
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
          aria-label="שם חברה"
        />
        <input
          className={styles.input}
          placeholder="תחום (למשל: אינטגרטור AV, חשמל)"
          value={field}
          onChange={(event) => setField(event.target.value)}
          aria-label="תחום"
        />
        <button className={styles.addButton} type="submit" disabled={creating || !companyName.trim()}>
          הוסף קבלן +
        </button>
      </form>

      {!mounted || entries === undefined ? (
        <p className={styles.empty}>טוען…</p>
      ) : entries.length === 0 ? (
        <p className={styles.empty}>אין עדיין קבלנים בבנק. הוסף קבלן ראשון למעלה.</p>
      ) : (
        <ul className={styles.list}>
          {entries.map((entry) => (
            <ContractorBankCard key={entry.id} entry={entry} onDelete={() => handleDelete(entry)} />
          ))}
        </ul>
      )}
    </main>
  );
}

function ContractorBankCard({ entry, onDelete }: { entry: ContractorBankEntry; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [companyName, setCompanyName] = useState(entry.companyName);
  const [field, setField] = useState(entry.field ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const name = companyName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await updateContractorBankEntry(entry.id, { companyName: name, field: field.trim() || null });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setCompanyName(entry.companyName);
    setField(entry.field ?? "");
    setEditing(false);
  }

  if (editing) {
    return (
      <li className={styles.card}>
        <div className={styles.editForm}>
          <input
            className={styles.input}
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            aria-label="שם חברה"
          />
          <input
            className={styles.input}
            value={field}
            onChange={(event) => setField(event.target.value)}
            placeholder="תחום"
            aria-label="תחום"
          />
          <div className={styles.editActions}>
            <button type="button" className={styles.saveButton} onClick={handleSave} disabled={saving || !companyName.trim()}>
              {saving ? "שומר…" : "שמור"}
            </button>
            <button type="button" className={styles.stampButton} onClick={handleCancel}>
              ביטול
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className={styles.card}>
      <div className={styles.cardBody}>
        <div className={styles.name}>{entry.companyName}</div>
        {entry.field ? <div className={styles.meta}>{entry.field}</div> : null}
      </div>
      <div className={styles.cardActions}>
        <button type="button" className={styles.stampButton} onClick={() => setEditing(true)}>
          ערוך
        </button>
        <button type="button" className={styles.deleteButton} onClick={onDelete}>
          הסר
        </button>
      </div>
    </li>
  );
}
