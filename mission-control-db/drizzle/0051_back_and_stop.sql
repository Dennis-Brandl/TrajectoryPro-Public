ALTER TABLE "step_run" DROP CONSTRAINT "step_run_result_ck";--> statement-breakpoint
ALTER TABLE "runtime_control_event" ADD COLUMN "step_oid" text;--> statement-breakpoint
ALTER TABLE "runtime_control_event" ADD COLUMN "step_name" text;--> statement-breakpoint
ALTER TABLE "step_signature" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "step_run" ADD CONSTRAINT "step_run_result_ck" CHECK ("step_run"."result" in ('completed','failed','caught','aborted','stopped','cancelled','went_back'));