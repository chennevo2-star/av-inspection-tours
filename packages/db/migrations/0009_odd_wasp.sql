ALTER TABLE "tasks" RENAME COLUMN "responsible_party" TO "responsible_parties";--> statement-breakpoint
-- Hand-edited (drizzle-kit's own generated cast had no USING clause -- text -> text[] has no implicit
-- cast in Postgres and would fail outright). Preserves real production data: an existing single name
-- becomes a one-element array, NULL becomes '{}', matching the new column's NOT NULL + default '{}'.
ALTER TABLE "tasks" ALTER COLUMN "responsible_parties" SET DATA TYPE text[] USING (
  CASE WHEN "responsible_parties" IS NULL THEN '{}'::text[] ELSE ARRAY["responsible_parties"]::text[] END
);--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "responsible_parties" SET DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "responsible_parties" SET NOT NULL;