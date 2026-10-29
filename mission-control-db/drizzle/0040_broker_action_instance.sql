CREATE TABLE "broker_action_instance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_key" text NOT NULL,
	"workflow_instance_id" uuid NOT NULL,
	"step_instance_id" uuid NOT NULL,
	"target_instance_id" uuid,
	"state" text DEFAULT 'RUNNING' NOT NULL,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broker_action_instance_state_ck" CHECK ("broker_action_instance"."state" in ('RUNNING','COMPLETED','ABORTED'))
);
--> statement-breakpoint
CREATE INDEX "broker_action_instance_running_idx" ON "broker_action_instance" USING btree ("state") WHERE "broker_action_instance"."state" = 'RUNNING';