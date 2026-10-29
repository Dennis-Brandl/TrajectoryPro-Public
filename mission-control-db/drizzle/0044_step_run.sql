CREATE TABLE "step_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_instance_id" uuid NOT NULL,
	"runtime_label" text NOT NULL,
	"work_center_id" uuid,
	"step_instance_id" uuid,
	"step_oid" text NOT NULL,
	"step_name" text NOT NULL,
	"step_type" text NOT NULL,
	"run_number" integer NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone NOT NULL,
	"result" text NOT NULL,
	"error" text,
	"input_parameters" jsonb,
	"output_parameters" jsonb,
	"performed_by_user_id" uuid,
	"performed_by_login_name" text,
	"performed_by_kind" text NOT NULL,
	"node_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "step_run_result_ck" CHECK ("step_run"."result" in ('completed','failed','caught','aborted','stopped','cancelled')),
	CONSTRAINT "step_run_kind_ck" CHECK ("step_run"."performed_by_kind" in ('user','script','action','gate','system'))
);
--> statement-breakpoint
ALTER TABLE "runtime_history" ADD COLUMN "started_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "runtime_history" ADD COLUMN "started_by_login_name" text;--> statement-breakpoint
ALTER TABLE "step_run" ADD CONSTRAINT "step_run_work_center_id_work_center_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_center"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_run" ADD CONSTRAINT "step_run_performed_by_user_id_app_user_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "step_run_instance_idx" ON "step_run" USING btree ("workflow_instance_id","step_oid","started_at");