CREATE TABLE "work_center_control_grant" (
	"source_work_center_id" uuid NOT NULL,
	"target_work_center_id" uuid NOT NULL,
	"scope" text DEFAULT 'own' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "work_center_control_grant_source_work_center_id_target_work_center_id_pk" PRIMARY KEY("source_work_center_id","target_work_center_id"),
	CONSTRAINT "work_center_control_grant_scope_ck" CHECK ("work_center_control_grant"."scope" in ('own','any')),
	CONSTRAINT "work_center_control_grant_distinct_ck" CHECK ("work_center_control_grant"."source_work_center_id" <> "work_center_control_grant"."target_work_center_id")
);
--> statement-breakpoint
ALTER TABLE "workflow_instance" DROP CONSTRAINT "workflow_instance_trigger_ck";--> statement-breakpoint
ALTER TABLE "runtime_history" ADD COLUMN "created_by_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "runtime_history" ADD COLUMN "created_by_label" text;--> statement-breakpoint
ALTER TABLE "runtime_history" ADD COLUMN "outputs" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "created_by_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "created_by_step_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "created_by_step_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "created_by_label" text;--> statement-breakpoint
ALTER TABLE "work_center_control_grant" ADD CONSTRAINT "work_center_control_grant_source_work_center_id_work_center_id_fk" FOREIGN KEY ("source_work_center_id") REFERENCES "public"."work_center"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_center_control_grant" ADD CONSTRAINT "work_center_control_grant_target_work_center_id_work_center_id_fk" FOREIGN KEY ("target_work_center_id") REFERENCES "public"."work_center"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_center_control_grant" ADD CONSTRAINT "work_center_control_grant_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_center_control_grant_target_idx" ON "work_center_control_grant" USING btree ("target_work_center_id");--> statement-breakpoint
CREATE INDEX "runtime_history_created_by_idx" ON "runtime_history" USING btree ("created_by_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_instance_created_by_step_uq" ON "workflow_instance" USING btree ("created_by_step_instance_id","created_by_step_started_at") WHERE "workflow_instance"."created_by_step_instance_id" is not null;--> statement-breakpoint
CREATE INDEX "workflow_instance_created_by_idx" ON "workflow_instance" USING btree ("created_by_instance_id");--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_trigger_ck" CHECK ("workflow_instance"."triggered_by" in ('schedule','manual','event','workflow'));