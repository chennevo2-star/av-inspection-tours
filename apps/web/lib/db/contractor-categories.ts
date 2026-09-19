import { ContractorCategory } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";

/** Managed field/discipline categories for the contractor bank (session's user request) — see
 * ContractorCategory's own doc comment in shared-types for how this relates to the plain `field` string
 * still stored on Contractor/ContractorBankEntry. */
export async function listContractorCategories(): Promise<ContractorCategory[]> {
  const categories = await getLocalDb().contractorCategories.toArray();
  return categories.sort((a, b) => a.name.localeCompare(b.name, "he"));
}

export async function createContractorCategory(name: string): Promise<ContractorCategory> {
  const category = ContractorCategory.parse({ id: crypto.randomUUID(), name });
  await getLocalDb().contractorCategories.add(category);
  return category;
}

export async function deleteContractorCategory(id: string): Promise<void> {
  await getLocalDb().contractorCategories.delete(id);
}

/** Ensures a category exists for `name` (dedup by trimmed/case-insensitive match, same rule as
 * upsertContractorBankEntryByName) — called whenever a contractor's field is set to a value that isn't
 * an existing category yet, so typing a new one "creates" it for future reuse without a separate step. */
export async function upsertContractorCategoryByName(name: string): Promise<ContractorCategory> {
  const trimmed = name.trim();
  const normalized = trimmed.toLowerCase();
  const existing = (await getLocalDb().contractorCategories.toArray()).find(
    (category) => category.name.trim().toLowerCase() === normalized
  );
  if (existing) return existing;
  return createContractorCategory(trimmed);
}
