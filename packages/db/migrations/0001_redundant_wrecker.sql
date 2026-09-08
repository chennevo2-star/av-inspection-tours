DO $$ BEGIN
 CREATE TYPE "public"."ai_extraction_status" AS ENUM('processing', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_extractions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inspection_id" uuid NOT NULL,
	"status" "ai_extraction_status" DEFAULT 'processing' NOT NULL,
	"transcript" text,
	"raw_extraction" jsonb,
	"error_message" text,
	"transcription_model" text,
	"extraction_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
