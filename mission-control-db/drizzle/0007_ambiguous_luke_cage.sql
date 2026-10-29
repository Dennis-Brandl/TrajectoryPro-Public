CREATE TABLE IF NOT EXISTS "instance_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_instance_id" uuid NOT NULL,
	"work_center_id" uuid NOT NULL,
	"resolved_role_id" uuid,
	"assigned_user_id" uuid,
	"status" text DEFAULT 'assigned' NOT NULL,
	"dispatch_policy" text,
	"dispatch_reason" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "instance_assignment_status_ck" CHECK ("instance_assignment"."status" in ('assigned','claimed','completed','reassigned','cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operator_presence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"attending_work_center_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"status" text DEFAULT 'online' NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_presence_status_ck" CHECK ("operator_presence"."status" in ('online','away','offline'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "step_instance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_instance_id" uuid NOT NULL,
	"node_oid" text NOT NULL,
	"step_oid" text NOT NULL,
	"step_type" text NOT NULL,
	"state" text NOT NULL,
	"order_index" integer,
	"input_params" jsonb,
	"output_params" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trace_entry" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trace_entry_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workflow_instance_id" uuid NOT NULL,
	"step_oid" text,
	"state" text NOT NULL,
	"order_index" integer NOT NULL,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_instance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"work_center_id" uuid NOT NULL,
	"schedule_id" uuid,
	"environment_spec_id" uuid,
	"triggered_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"final_state" text,
	"property_store" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_instance_trigger_ck" CHECK ("workflow_instance"."triggered_by" in ('schedule','manual','event')),
	CONSTRAINT "workflow_instance_status_ck" CHECK ("workflow_instance"."status" in ('pending','running','paused','completed','aborted','errored','stopped'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instance_assignment" ADD CONSTRAINT "instance_assignment_step_instance_id_step_instance_id_fk" FOREIGN KEY ("step_instance_id") REFERENCES "public"."step_instance"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instance_assignment" ADD CONSTRAINT "instance_assignment_work_center_id_work_center_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_center"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instance_assignment" ADD CONSTRAINT "instance_assignment_resolved_role_id_role_id_fk" FOREIGN KEY ("resolved_role_id") REFERENCES "public"."role"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instance_assignment" ADD CONSTRAINT "instance_assignment_assigned_user_id_app_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operator_presence" ADD CONSTRAINT "operator_presence_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "operator_presence" ADD CONSTRAINT "operator_presence_attending_work_center_id_work_center_id_fk" FOREIGN KEY ("attending_work_center_id") REFERENCES "public"."work_center"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "step_instance" ADD CONSTRAINT "step_instance_workflow_instance_id_workflow_instance_id_fk" FOREIGN KEY ("workflow_instance_id") REFERENCES "public"."workflow_instance"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trace_entry" ADD CONSTRAINT "trace_entry_workflow_instance_id_workflow_instance_id_fk" FOREIGN KEY ("workflow_instance_id") REFERENCES "public"."workflow_instance"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_work_center_id_work_center_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_center"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_environment_spec_id_environment_spec_id_fk" FOREIGN KEY ("environment_spec_id") REFERENCES "public"."environment_spec"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instance_assignment_user_status_idx" ON "instance_assignment" USING btree ("assigned_user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instance_assignment_step_idx" ON "instance_assignment" USING btree ("step_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "operator_presence_session_uq" ON "operator_presence" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "operator_presence_user_wc_uq" ON "operator_presence" USING btree ("user_id","attending_work_center_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_presence_wc_status_idx" ON "operator_presence" USING btree ("attending_work_center_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "step_instance_state_idx" ON "step_instance" USING btree ("workflow_instance_id","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trace_entry_instance_order_idx" ON "trace_entry" USING btree ("workflow_instance_id","order_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_instance_wc_status_idx" ON "workflow_instance" USING btree ("work_center_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_instance_workflow_idx" ON "workflow_instance" USING btree ("workflow_id");