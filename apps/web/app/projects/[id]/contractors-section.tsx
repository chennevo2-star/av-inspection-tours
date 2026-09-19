"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Contractor, ContractorAlias, ContractorBankEntry } from "@av-inspection/shared-types";
import { getLocalDb } from "../../../lib/db/local-db";
import {
  addContractorAlias,
  createContractor,
  deleteContractor,
  deleteContractorAlias,
} from "../../../lib/db/contractors";
import { listContractorBank } from "../../../lib/db/contractor-bank";
import { CategoryPicker } from "../../../components/category-picker";
import { useMounted } from "../../../lib/hooks/use-mounted";
import styles from "./project-screen.module.css";

/**
 * Contractors + aliases (spec §Contractor, §25). Live-queried straight from IndexedDB. Offers the
 * cross-project bank (user request: "בפרויקט ניתן לבחור מרשימת קבלנים או להוסיף קבלן חדש") as quick-pick
 * chips above the add form — clicking one pre-fills the form rather than adding directly, so the user can
 * still adjust the field/discipline for this specific project before confirming.
 */
export function ContractorsSection({ projectId }: { projectId: string }) {
  const mounted = useMounted();
  const [companyName, setCompanyName] = useState("");
  const [field, setField] = useState("");
  const [creating, setCreating] = useState(false);

  const contractors = useLiveQuery(
    () =>
      mounted
        ? getLocalDb().contractors.where("projectId").equals(projectId).toArray()
        : Promise.resolve<Contractor[]>([]),
    [mounted, projectId]
  );

  const bank = useLiveQuery(
    () => (mounted ? listContractorBank() : Promise.resolve<ContractorBankEntry[]>([])),
    [mounted]
  );

  // Companies already added to THIS project don't need to be offered again as quick-pick chips.
  const alreadyAdded = useMemo(
    () => new Set((contractors ?? []).map((c) => c.companyName)),
    [contractors]
  );
  const bankOptions = useMemo(
    () => (bank ?? []).filter((entry) => !alreadyAdded.has(entry.companyName)),
    [bank, alreadyAdded]
  );

  function handlePickFromBank(entry: ContractorBankEntry) {
    setCompanyName(entry.companyName);
    setField(entry.field ?? "");
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const name = companyName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createContractor(projectId, { companyName: name, field: field.trim() || null });
      setCompanyName("");
      setField("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>קבלנים</h2>

      {bankOptions.length > 0 ? (
        <div className={styles.aliasRow} style={{ marginBottom: 10 }}>
          {bankOptions.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={styles.aliasChip}
              onClick={() => handlePickFromBank(entry)}
            >
              + {entry.companyName}
            </button>
          ))}
        </div>
      ) : null}

      <form className={styles.inlineForm} onSubmit={handleAdd}>
        <input
          placeholder="שם חברה"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          aria-label="שם חברה"
        />
        <CategoryPicker value={field} onChange={setField} />
        <button className={styles.addButton} type="submit" disabled={creating || !companyName.trim()}>
          הוסף קבלן
        </button>
      </form>

      {!mounted || contractors === undefined ? (
        <p className={styles.emptyHint}>טוען…</p>
      ) : contractors.length === 0 ? (
        <p className={styles.emptyHint}>אין עדיין קבלנים בפרויקט זה.</p>
      ) : (
        <ul className={styles.list}>
          {contractors.map((contractor) => (
            <ContractorRow key={contractor.id} contractor={contractor} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ContractorRow({ contractor }: { contractor: Contractor }) {
  const [aliasInput, setAliasInput] = useState("");

  const aliases = useLiveQuery(
    () => getLocalDb().contractorAliases.where("contractorId").equals(contractor.id).toArray(),
    [contractor.id]
  );

  async function handleAddAlias(event: FormEvent) {
    event.preventDefault();
    const alias = aliasInput.trim();
    if (!alias) return;
    await addContractorAlias(contractor.id, alias);
    setAliasInput("");
  }

  return (
    <li className={styles.item}>
      <div className={styles.itemHeader}>
        <div>
          <div className={styles.itemName}>{contractor.companyName}</div>
          {contractor.field ? <div className={styles.itemMeta}>{contractor.field}</div> : null}
        </div>
        <button className={styles.deleteButton} onClick={() => deleteContractor(contractor.id)}>
          הסר
        </button>
      </div>

      {aliases && aliases.length > 0 ? (
        <div className={styles.aliasRow}>
          {aliases.map((alias: ContractorAlias) => (
            <span key={alias.id} className={styles.aliasChip}>
              {alias.alias}
              <button onClick={() => deleteContractorAlias(alias.id)} aria-label={`הסר כינוי ${alias.alias}`}>
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <form onSubmit={handleAddAlias} style={{ marginTop: 8, display: "flex", gap: 6 }}>
        <input
          placeholder="הוסף כינוי (למשל: הדסינמה, Hadas Cinema)"
          value={aliasInput}
          onChange={(e) => setAliasInput(e.target.value)}
          style={{
            flex: 1,
            background: "var(--bg)",
            border: "1px solid var(--surface-2)",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 13,
          }}
        />
        <button className={styles.deleteButton} style={{ color: "var(--accent)" }} type="submit">
          הוסף
        </button>
      </form>
    </li>
  );
}
