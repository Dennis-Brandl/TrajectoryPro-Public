CREATE TABLE IF NOT EXISTS "work_center" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_work_center_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"dispatch_policy" text DEFAULT 'least_queued_steps' NOT NULL,
	"dispatch_params" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_center_dispatch_ck" CHECK ("work_center"."dispatch_policy" in ('least_queued_steps','highest_priority','round_robin','fewest_active_instances','manual'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_center" ADD CONSTRAINT "work_center_parent_work_center_id_work_center_id_fk" FOREIGN KEY ("parent_work_center_id") REFERENCES "public"."work_center"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_center_root_name_uq" ON "work_center" USING btree ("name") WHERE "work_center"."parent_work_center_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_center_child_name_uq" ON "work_center" USING btree ("parent_work_center_id","name") WHERE "work_center"."parent_work_center_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_center_parent_idx" ON "work_center" USING btree ("parent_work_center_id");