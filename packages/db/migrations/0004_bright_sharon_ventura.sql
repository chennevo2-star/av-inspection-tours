CREATE TABLE IF NOT EXISTS "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inspection_id" uuid NOT NULL,
	"floor_id" uuid,
	"room_id" uuid,
	"task_id" uuid,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"cloud_file_id" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachments" ADD CONSTRAINT "attachments_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachments" ADD CONSTRAINT "attachments_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachments" ADD CONSTRAINT "attachments_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachments" ADD CONSTRAINT "attachments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
