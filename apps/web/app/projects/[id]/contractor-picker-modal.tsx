"use client";

import { useMemo, useState } from "react";
import type { ContractorBankEntry } from "@av-inspection/shared-types";
import { createContractor } from "../../../lib/db/contractors";
import styles from "./contractor-picker-modal.module.css";

const UNCATEGORIZED = "ללא קטגוריה";

function groupByCategory(entries: ContractorBankEntry[]): Array<[string, ContractorBankEntry[]]> {
  const byCategory = new Map<string, ContractorBankEntry[]>();
  for (const entry of entries) {
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
}

/**
 * "רשימת קבלנים" picker (user request, replacing the old flat chip row of bank quick-picks): a full-screen
 * list of the cross-project contractor bank -- filterable by category like contractor-bank-screen.tsx's
 * own filter row -- where multiple contractors can be checked at once and added to this project in one
 * confirm, instead of one chip-click (which only pre-filled the add form) at a time. `bankOptions` is
 * already filtered by the caller to bank entries not yet added to this project.
 */
export function ContractorPickerModal({
  projectId,
  bankOptions,
  onClose,
}: {
  projectId: string;
  bankOptions: ContractorBankEntry[];
  onClose: () => void;
}) {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const groups = useMemo(() => groupByCategory(bankOptions), [bankOptions]);
  const visibleGroups = activeFilter ? groups.filter(([category]) => category === activeFilter) : groups;

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirm() {
    const selected = bankOptions.filter((entry) => selectedIds.has(entry.id));
    if (selected.length === 0) return;
    setAdding(true);
    try {
      // Sequential, not Promise.all -- createContractor() also registers/dedupes a bank entry as a
      // side effect (upsertContractorBankEntryByName), and Dexie transactions don't overlap safely when
      // fired concurrently from unrelated calls.
      for (const entry of selected) {
        await createContractor(projectId, {
          companyName: entry.companyName,
          field: entry.field,
          contactName: entry.contactName,
          phone: entry.phone,
          email: entry.email,
        });
      }
      onClose();
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <header className={styles.header}>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="סגור">
          ✕
        </button>
        <h1 className={styles.title}>רשימת קבלנים</h1>
      </header>

      <div className={styles.body}>
        {bankOptions.length === 0 ? (
          <p className={styles.empty}>כל הקבלנים בבנק כבר משויכים לפרויקט זה.</p>
        ) : (
          <>
            <div className={styles.filterRow}>
              <button
                type="button"
                className={`${styles.filterChip} ${activeFilter === null ? styles.filterChipActive : ""}`}
                onClick={() => setActiveFilter(null)}
              >
                הכל ({bankOptions.length})
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
                    <li key={entry.id}>
                      <label className={`${styles.row} ${selectedIds.has(entry.id) ? styles.rowSelected : ""}`}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(entry.id)}
                          onChange={() => toggle(entry.id)}
                        />
                        <span className={styles.rowName}>{entry.companyName}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>

      {bankOptions.length > 0 ? (
        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.confirmButton}
            onClick={() => void handleConfirm()}
            disabled={selectedIds.size === 0 || adding}
          >
            {adding ? "מוסיף…" : selectedIds.size > 0 ? `הוסף ${selectedIds.size} קבלנים לפרויקט` : "בחר קבלנים להוספה"}
          </button>
        </footer>
      ) : null}
    </div>
  );
}
