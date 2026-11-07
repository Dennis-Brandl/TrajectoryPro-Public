CREATE TABLE "runtime_control_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "runtime_control_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workflow_instance_id" uuid NOT NULL,
	"verb" text NOT NULL,
	"effect" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"actor_login_name" text,
	"actor_display_name" text,
	"actor_label" text,
	"actor_instance_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_control_event_verb_ck" CHECK ("runtime_control_event"."verb" in ('stop','abort')),
	CONSTRAINT "runtime_control_event_effect_ck" CHECK ("runtime_control_event"."effect" in ('request','escalate','skip_cleanup')),
	CONSTRAINT "runtime_control_event_actor_kind_ck" CHECK ("runtime_control_event"."actor_kind" in ('user','remote','system'))
);
--> statement-breakpoint
ALTER TABLE "workflow_instance" DROP CONSTRAINT "workflow_instance_status_ck";--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "cleanup_skip" text;--> statement-breakpoint
ALTER TABLE "runtime_control_event" ADD CONSTRAINT "runtime_control_event_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runtime_control_event_instance_idx" ON "runtime_control_event" USING btree ("workflow_instance_id");--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_cleanup_skip_ck" CHECK ("workflow_instance"."cleanup_skip" in ('stop','abort'));--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_status_ck" CHECK ("workflow_instance"."status" in ('pending','queued','running','pausing','paused','resuming','stopping','aborting','completed','aborted','errored','stopped','stopping_cleanup','aborting_cleanup'));