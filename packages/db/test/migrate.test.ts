import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getDb, getDbDriver, inspections, projects, runMigrations } from "../src/index.js";

/**
 * Real integration test against the ADR-007 local dev path: an embedded PGlite instance, real Postgres
 * SQL semantics, no Docker/network required. Proves the generated migration (packages/db/migrations/,
 * from `npm run db:generate`) actually creates a working schema — not just that schema.ts typechecks.
 */
describe("runMigrations against PGlite", () => {
  let dataDir: string;

  beforeAll(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "av-inspection-pglite-test-"));
    process.env.PGLITE_DATA_DIR = dataDir;
    delete process.env.DATABASE_URL; // make sure this test exercises the pglite path, not real postgres
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates every table and allows a real round-trip insert/select", async () => {
    expect(getDbDriver()).toBe("pglite");
    await runMigrations();

    const db = getDb();
    const projectId = "11111111-1111-1111-1111-111111111111";
    await db.insert(projects).values({
      id: projectId,
      name: "פרויקט בדיקה",
      status: "פעיל",
    });

    const rows = await db.select().from(projects);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: projectId, name: "פרויקט בדיקה" });

    // Foreign keys are real — an inspection needs a real project row to reference.
    const inspectionId = "22222222-2222-2222-2222-222222222222";
    await db.insert(inspections).values({
      id: inspectionId,
      projectId,
      inspectionNumber: 1,
      date: "2026-09-08",
      startTime: new Date(),
      inspector: "דני",
    });
    const inspectionRows = await db.select().from(inspections);
    expect(inspectionRows).toHaveLength(1);

    // Re-running migrations must be a safe no-op, not an error on already-applied migrations.
    await expect(runMigrations()).resolves.not.toThrow();
  });
});
