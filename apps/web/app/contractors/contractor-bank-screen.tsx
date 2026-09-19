"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import type { ContractorBankEntry } from "@av-inspection/shared-types";
import {
  createContractorBankEntry,
  deleteContractorBankEntry,
  listContractorBank,
  updateContractorBankEntry,
} from "../../lib/db/contractor-bank";
import { CategoryPicker } from "../../components/category-picker";
import { useMounted } from "../../lib/hooks/use-mounted";
import styles from "./contractor-bank-screen.module.css";

const UNCATEGORIZED = "ללא קטגוריה";

/**
 * "רשימת קבלנים" (session's user request): manage the cross-project contractor bank directly — add, edit,
 * remove. Separate from a project's own קבלנים section (contractors-section.tsx), which now offers this
 * bank as quick-pick options rather than owning the data itself — see ContractorBankEntry's own doc
 * comment in shared-types for how the two relate. Reachable directly from the main menu (user request —
 * moved off the Settings hub, where it first briefly lived).
 *
 * Grouped and filterable by category (further user request) — `entry.field` doubles as the category name
 * (see ContractorCategory's own doc comment for why that stays a plain string, not a real foreign key).
 */
export function ContractorBankScreen() {
  const mounted = useMounted();
  const [companyName, setCompanyName] = useState("");
  const [field, setField] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const entries = useLiveQuery(
    () => (mounted ? listContractorBank() : Promise.resolve<ContractorBankEntry[]>([])),
    [mounted]
  );

  const groups = useMemo(() => {
    const byCategory = new Map<string, ContractorBankEntry[]>();
    for (const entry of entries ?? []) {
      const key = entry.field?.trim() || UNCATEGORIZED;
      const list = byCategory.get(key) ?? [];
      list.push(entry);
      byCategory.set(key, list);
    }
    return [...byCategory.entries()].sort(([a], [b]) => {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      return a.localeCompare(b, "he");
    });
  }, [entries]);

  const visibleGroups = activeFilter ? groups.filter(([category]) => category === activeFilter) : groups;

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
        <CategoryPicker value={field} onChange={setField} />
        <button className={styles.addButton} type="submit" disabled={creating || !companyName.trim()}>
          הוסף קבלן +
        </button>
      </form>

      {!mounted || entries === undefined ? (
        <p className={styles.empty}>טוען…</p>
      ) : entries.length === 0 ? (
        <p className={styles.empty}>אין עדיין קבלנים בבנק. הוסף קבלן ראשון למעלה.</p>
      ) : (
        <>
          <div className={styles.filterRow}>
            <button
              type="button"
              className={`${styles.filterChip} ${activeFilter === null ? styles.filterChipActive : ""}`}
              onClick={() => setActiveFilter(null)}
            >
              הכל ({entries.length})
            </button>
            {groups.map(([category, items]) => (
              <button
                key={category}
                type="button"
                className={`${styles.filterChip} ${activeFilter === category ? styles.filterChipActive : ""}`}
                onClick={() => setActiveFilter(category)}
              >
                {category} ({items.length})
              </button>
            ))}
          </div>

          {visibleGroups.map(([category, items]) => (
            <section key={category} className={styles.group}>
              <h2 className={styles.groupTitle}>{category}</h2>
              <ul className={styles.list}>
                {items.map((entry) => (
                  <ContractorBankCard key={entry.id} entry={entry} onDelete={() => handleDelete(entry)} />
                ))}
              </ul>
            </section>
          ))}
        </>
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
          <CategoryPicker value={field} onChange={setField} />
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
