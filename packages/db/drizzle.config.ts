import { defineConfig } from "drizzle-kit";

// Not yet run against a real database in this environment — no Postgres instance is provisioned here.
// This config + packages/db/src/schema.ts define the intended server schema (Phase 1 deliverable);
// `npm run db:generate` / `db:migrate` are for whoever provisions the actual Postgres instance
// (see ARCHITECTURE.md's "What Phase 1 actually contains" note — this is schema-as-code, not a
// verified-against-a-live-DB migration yet).
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/av_inspection_tours",
  },
});
