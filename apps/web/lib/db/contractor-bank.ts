import { ContractorBankEntry } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";
import { upsertContractorCategoryByName } from "./contractor-categories";

export interface ContractorBankInput {
  companyName: string;
  field?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** A non-empty `field` always registers/reuses a category (session's user request: typing a new field
 * value creates the category deliberately, not just implicitly) — a no-op for null/empty. */
async function registerCategoryIfSet(field: string | null | undefined): Promise<void> {
  if (field && field.trim()) await upsertContractorCategoryByName(field);
}

/** The cross-project contractor "bank" (session's user request) — see ContractorBankEntry's own doc
 * comment in shared-types for why this is a separate, local-only entity from the per-project Contractor. */
export async function listContractorBank(): Promise<ContractorBankEntry[]> {
  const entries = await getLocalDb().contractorBank.toArray();
  return entries.sort((a, b) => a.companyName.localeCompare(b.companyName, "he"));
}

export async function createContractorBankEntry(input: ContractorBankInput): Promise<ContractorBankEntry> {
  await registerCategoryIfSet(input.field);
  const entry = ContractorBankEntry.parse({
    id: crypto.randomUUID(),
    companyName: input.companyName,
    field: input.field ?? null,
    contactName: input.contactName ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
  });
  await getLocalDb().contractorBank.add(entry);
  return entry;
}

export async function updateContractorBankEntry(
  id: string,
  patch: Partial<ContractorBankInput>
): Promise<ContractorBankEntry> {
  await registerCategoryIfSet(patch.field);
  const db = getLocalDb();
  const existing = await db.contractorBank.get(id);
  if (!existing) throw new Error(`updateContractorBankEntry: entry ${id} not found locally`);
  const updated = ContractorBankEntry.parse({ ...existing, ...patch });
  await db.contractorBank.put(updated);
  return updated;
}

export async function deleteContractorBankEntry(id: string): Promise<void> {
  await getLocalDb().contractorBank.delete(id);
}

/**
 * Ensures a bank entry exists for `companyName`, matched case/whitespace-insensitively so "אבנר בע״מ" and
 * "  אבנר בע״מ " don't create two entries — called from createContractor() (project-level) every time a
 * contractor is added to a project, which is the "a contractor added to a project also enters the bank"
 * behavior the user asked for. Never overwrites an existing entry's own details (a project's one-off
 * contact/phone for this job shouldn't silently rewrite the bank's general record) — leaves it as-is if
 * already present.
 */
export async function upsertContractorBankEntryByName(input: ContractorBankInput): Promise<ContractorBankEntry> {
  await registerCategoryIfSet(input.field);
  const normalized = input.companyName.trim().toLowerCase();
  const existing = (await getLocalDb().contractorBank.toArray()).find(
    (entry) => entry.companyName.trim().toLowerCase() === normalized
  );
  if (existing) return existing;
  return createContractorBankEntry(input);
}
