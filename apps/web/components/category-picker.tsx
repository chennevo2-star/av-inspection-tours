"use client";

import { useLiveQuery } from "dexie-react-hooks";
import type { ContractorCategory } from "@av-inspection/shared-types";
import { listContractorCategories } from "../lib/db/contractor-categories";
import styles from "./category-picker.module.css";

/**
 * A plain text input for a contractor's "תחום" (field), plus quick-pick chips for existing categories
 * (session's user request: group/filter the contractor bank by category, and let new ones be created
 * deliberately). Typing a value not yet in the list still works and registers as a new category the next
 * time it's actually saved (contractor-bank.ts's own `registerCategoryIfSet`) — this component itself
 * only reads the category list, it never writes to it, matching how the equivalent
 * contractor-bank/inspector-bank chip pickers elsewhere in this app work.
 */
export function CategoryPicker({
  value,
  onChange,
  inputId,
}: {
  value: string;
  onChange: (value: string) => void;
  inputId?: string;
}) {
  const categories = useLiveQuery(
    () => listContractorCategories(),
    []
  ) as ContractorCategory[] | undefined;

  return (
    <div className={styles.wrap}>
      <input
        id={inputId}
        className={styles.input}
        placeholder="תחום (למשל: אינטגרטור AV, חשמל)"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="תחום"
      />
      {categories && categories.length > 0 ? (
        <div className={styles.chipRow}>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={`${styles.chip} ${category.name === value ? styles.chipActive : ""}`}
              onClick={() => onChange(category.name)}
            >
              {category.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
