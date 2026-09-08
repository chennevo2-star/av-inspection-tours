import { Contractor, ContractorAlias } from "@av-inspection/shared-types";
import { getLocalDb } from "./local-db";
import { enqueueSync } from "../sync/enqueue";

export interface CreateContractorInput {
  companyName: string;
  field?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
}

export async function createContractor(projectId: string, input: CreateContractorInput): Promise<Contractor> {
  const contractor = Contractor.parse({
    id: crypto.randomUUID(),
    projectId,
    companyName: input.companyName,
    field: input.field ?? null,
    contactName: input.contactName ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    syncStatus: "LOCAL_ONLY",
  });
  await getLocalDb().contractors.add(contractor);
  await enqueueSync("Contractor", contractor.id, "create", contractor);
  return contractor;
}

export async function listContractors(projectId: string): Promise<Contractor[]> {
  return getLocalDb().contractors.where("projectId").equals(projectId).toArray();
}

export async function deleteContractor(id: string): Promise<void> {
  const db = getLocalDb();
  const aliases = await db.contractorAliases.where("contractorId").equals(id).toArray();
  await db.transaction("rw", db.contractors, db.contractorAliases, async () => {
    await db.contractorAliases.bulkDelete(aliases.map((a) => a.id));
    await db.contractors.delete(id);
  });
  // Same known gap as floors/rooms: local delete isn't sync-propagated yet (Phase 4).
}

/**
 * Alias matching (spec §25 — "סינמה"/"הדסינמה"/"Hadas Cinema" → one Contractor_ID). Aliases are lookup
 * data owned by their contractor; they don't get their own SyncEntityType — they travel inside the
 * Contractor payload once Phase 4 wires real sync (see packages/shared-types's ContractorAlias comment).
 */
export async function addContractorAlias(contractorId: string, alias: string): Promise<ContractorAlias> {
  const trimmed = alias.trim();
  if (!trimmed) throw new Error("addContractorAlias: alias must not be empty");

  const record = ContractorAlias.parse({
    id: crypto.randomUUID(),
    contractorId,
    alias: trimmed,
  });
  await getLocalDb().contractorAliases.add(record);
  return record;
}

export async function listContractorAliases(contractorId: string): Promise<ContractorAlias[]> {
  return getLocalDb().contractorAliases.where("contractorId").equals(contractorId).toArray();
}

export async function deleteContractorAlias(id: string): Promise<void> {
  await getLocalDb().contractorAliases.delete(id);
}
