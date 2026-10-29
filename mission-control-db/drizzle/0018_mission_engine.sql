-- Mission Engine core (program phase 3). Hand-written; see 0017 for the convention.
-- Precondition (same stance as 0017): workflow_instance / step_instance / trace_entry carry no
-- pre-engine rows (only the never-wired prototype harness ever wrote them). ADD CONSTRAINT
-- fails visibly if that no longer holds; remedy is manual inspection, not a silent rewrite.
ALTER TABLE "step_instance" ADD COLUMN "wake_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "step_instance" ADD COLUMN "action_instance_id" text;--> statement-breakpoint
ALTER TABLE "step_instance" ADD COLUMN "action_server_uri" text;--> statement-breakpoint
CREATE INDEX "step_instance_wake_idx" ON "step_instance" ("wake_at") WHERE "wake_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "step_instance" ADD CONSTRAINT "step_instance_state_ck" CHECK ("state" in ('READY','EXECUTING','WAITING_ACTION','WAITING_USER','PAUSED','COMPLETED','ERRORED','ABORTED','CANCELLED'));--> statement-breakpoint
ALTER TABLE "trace_entry" ADD COLUMN "after_action" integer;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "engine_state" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_instance" DROP CONSTRAINT "workflow_instance_status_ck";--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_status_ck" CHECK ("status" in ('pending','queued','running','pausing','paused','resuming','stopping','aborting','completed','aborted','errored','stopped'));--> statement-breakpoint
ALTER TABLE "work_center" ADD COLUMN "finished_retention_secs" integer NOT NULL DEFAULT 3600;--> statement-breakpoint
CREATE TABLE "work_center_environment_binding" (
  "work_center_id" uuid NOT NULL REFERENCES "work_center"("id") ON DELETE CASCADE,
  "environment_oid" text NOT NULL,
  "server_uri" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "app_user"("id") ON DELETE SET NULL,
  PRIMARY KEY ("work_center_id", "environment_oid")
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION engine_wake_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('engine_wake', TG_TABLE_NAME);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "workflow_instance_wake" AFTER INSERT OR UPDATE OF "status" ON "workflow_instance" FOR EACH STATEMENT EXECUTE FUNCTION engine_wake_notify();--> statement-breakpoint
CREATE TRIGGER "step_instance_wake" AFTER UPDATE OF "state" ON "step_instance" FOR EACH STATEMENT EXECUTE FUNCTION engine_wake_notify();
