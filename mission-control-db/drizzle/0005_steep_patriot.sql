CREATE TABLE IF NOT EXISTS "work_center_environment" (
	"work_center_id" uuid NOT NULL,
	"environment_spec_id" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_center_environment_work_center_id_environment_spec_id_pk" PRIMARY KEY("work_center_id","environment_spec_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_center_workflow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_center_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"dispatch_policy" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wcw_dispatch_ck" CHECK ("work_center_workflow"."dispatch_policy" is null or "work_center_workflow"."dispatch_policy" in ('least_queued_steps','highest_priority','round_robin','fewest_active_instances','manual'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_center_workflow_allowed_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_center_workflow_id" uuid NOT NULL,
	"workflow_node_id" uuid NOT NULL,
	"role_id" uuid NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_center_environment" ADD CONSTRAINT "work_center_environment_work_center_id_work_center_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_center"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_center_environment" ADD CONSTRAINT "work_center_environment_environment_spec_id_environment_spec_id_fk" FOREIGN KEY ("environment_spec_id") REFERENCES "public"."environment_spec"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_center_workflow" ADD CONSTRAINT "work_center_workflow_work_center_id_work_center_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_center"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_center_workflow" ADD CONSTRAINT "work_center_workflow_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_center_workflow_allowed_role" ADD CONSTRAINT "work_center_workflow_allowed_role_work_center_workflow_id_work_center_workflow_id_fk" FOREIGN KEY ("work_center_workflow_id") REFERENCES "public"."work_center_workflow"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_center_workflow_allowed_role" ADD CONSTRAINT "work_center_workflow_allowed_role_workflow_node_id_workflow_node_id_fk" FOREIGN KEY ("workflow_node_id") REFERENCES "public"."workflow_node"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_center_workflow_allowed_role" ADD CONSTRAINT "work_center_workflow_allowed_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_center_workflow_uq" ON "work_center_workflow" USING btree ("work_center_id","workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_center_workflow_workflow_idx" ON "work_center_workflow" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wcw_allowed_role_uq" ON "work_center_workflow_allowed_role" USING btree ("work_center_workflow_id","workflow_node_id","role_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wcw_allowed_role_node_idx" ON "work_center_workflow_allowed_role" USING btree ("workflow_node_id");