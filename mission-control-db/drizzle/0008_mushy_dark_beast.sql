CREATE TABLE IF NOT EXISTS "schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_center_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"environment_spec_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"run_at" timestamp with time zone,
	"cron_expr" text,
	"timezone" text DEFAULT 'UTC',
	"next_fire_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_kind_ck" CHECK ("schedule"."kind" in ('one_time','recurring','event'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workflow_instance_id" uuid,
	"status" text NOT NULL,
	"detail" text,
	CONSTRAINT "schedule_run_status_ck" CHECK ("schedule_run"."status" in ('fired','skipped','failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trigger_condition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"type" text NOT NULL,
	"expression" jsonb NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trigger_condition_type_ck" CHECK ("trigger_condition"."type" in ('time','data','event'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule" ADD CONSTRAINT "schedule_work_center_id_work_center_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_center"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule" ADD CONSTRAINT "schedule_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule" ADD CONSTRAINT "schedule_environment_spec_id_environment_spec_id_fk" FOREIGN KEY ("environment_spec_id") REFERENCES "public"."environment_spec"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule" ADD CONSTRAINT "schedule_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_run" ADD CONSTRAINT "schedule_run_schedule_id_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_run" ADD CONSTRAINT "schedule_run_workflow_instance_id_workflow_instance_id_fk" FOREIGN KEY ("workflow_instance_id") REFERENCES "public"."workflow_instance"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trigger_condition" ADD CONSTRAINT "trigger_condition_schedule_id_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_work_center_idx" ON "schedule" USING btree ("work_center_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_next_fire_idx" ON "schedule" USING btree ("next_fire_at") WHERE "schedule"."enabled";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_run_schedule_idx" ON "schedule_run" USING btree ("schedule_id","fired_at");