ALTER TABLE "work_center" ADD COLUMN "next_runtime_number" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "work_center_user" ADD COLUMN "mission_commander" boolean NOT NULL DEFAULT false;--> statement-breakpoint
-- Control-recipe columns. NOT NULL with no default is DELIBERATE (spec §3): workflow_instance
-- must be empty (only the never-wired prototype harness ever wrote it); if rows exist this
-- fails visibly rather than inventing values.
ALTER TABLE "workflow_instance" ADD COLUMN "spec_jsonb" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "starting_params" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "runtime_number" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "master_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "master_oid" text NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "master_version" text NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "master_state" text NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "start_requested_by" uuid REFERENCES "app_user"("id") ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_instance_wc_number_uq" ON "workflow_instance" ("work_center_id","runtime_number");--> statement-breakpoint
CREATE INDEX "workflow_instance_queued_idx" ON "workflow_instance" ("queued_at") WHERE "status" = 'queued';--> statement-breakpoint
ALTER TABLE "workflow_instance" DROP CONSTRAINT "workflow_instance_status_ck";--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_status_ck" CHECK ("status" in ('pending','queued','running','paused','completed','aborted','errored','stopped'));--> statement-breakpoint
CREATE TABLE "runtime_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflow_instance_id" uuid,
  "work_center_id" uuid REFERENCES "work_center"("id") ON DELETE set null,
  "work_center_name" text NOT NULL,
  "runtime_number" integer NOT NULL,
  "master_name" text NOT NULL,
  "master_oid" text NOT NULL,
  "master_version" text NOT NULL,
  "master_state" text NOT NULL,
  "final_state" text NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone NOT NULL,
  "starting_params" jsonb,
  "trace" jsonb NOT NULL,
  "properties" jsonb,
  "step_params" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "runtime_history_final_state_ck" CHECK ("final_state" in ('completed','aborted','stopped','errored'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_history_instance_uq" ON "runtime_history" ("workflow_instance_id");--> statement-breakpoint
CREATE INDEX "runtime_history_wc_idx" ON "runtime_history" ("work_center_id","finished_at");--> statement-breakpoint
CREATE INDEX "runtime_history_finished_idx" ON "runtime_history" ("finished_at");
