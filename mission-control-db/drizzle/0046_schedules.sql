CREATE TABLE "api_client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"work_center_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "master_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_center_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"recurrence" jsonb NOT NULL,
	"source" text DEFAULT 'commander' NOT NULL,
	"external_key" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"updated_by_client" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "master_schedule_source_ck" CHECK ("master_schedule"."source" in ('commander','api'))
);
--> statement-breakpoint
CREATE TABLE "master_schedule_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_schedule_id" uuid NOT NULL,
	"parent_item_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"workflow_name" text NOT NULL,
	"workflow_version" text,
	"trigger_on" text[],
	"params" jsonb
);
--> statement-breakpoint
CREATE TABLE "runtime_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_center_id" uuid,
	"work_center_name" text NOT NULL,
	"master_schedule_id" uuid,
	"runtime_number" integer NOT NULL,
	"label" text NOT NULL,
	"name" text NOT NULL,
	"recurrence" jsonb NOT NULL,
	"time_zone" text NOT NULL,
	"master_revision" integer NOT NULL,
	"definition_hash" text NOT NULL,
	"external_key" text,
	"status" text DEFAULT 'active' NOT NULL,
	"next_fire_at" timestamp with time zone,
	"missed_from" timestamp with time zone,
	"missed_to" timestamp with time zone,
	"catchup_mode" text,
	"catchup_cursor" timestamp with time zone,
	"catchup_to" timestamp with time zone,
	"enabled_by_user" uuid,
	"enabled_by_client" uuid,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paused_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "runtime_schedule_status_ck" CHECK ("runtime_schedule"."status" in ('active','paused','cancelled','finished'))
);
--> statement-breakpoint
CREATE TABLE "runtime_schedule_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"action" text NOT NULL,
	"detail" jsonb,
	"master_schedule_id" uuid,
	"runtime_schedule_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_schedule_event_actor_ck" CHECK ("runtime_schedule_event"."actor_kind" in ('user','api_client','system'))
);
--> statement-breakpoint
CREATE TABLE "runtime_schedule_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runtime_schedule_id" uuid NOT NULL,
	"parent_item_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"trigger_on" text[],
	"params" jsonb,
	"workflow_id" uuid,
	"spec_jsonb" jsonb,
	"master_name" text NOT NULL,
	"master_oid" text NOT NULL,
	"master_version" text NOT NULL,
	"master_state" text NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_by" uuid
);
--> statement-breakpoint
CREATE TABLE "schedule_item_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"parent_run_id" uuid,
	"workflow_instance_id" uuid,
	"runtime_label" text,
	"status" text DEFAULT 'started' NOT NULL,
	"final_state" text,
	"trigger_values" jsonb,
	"detail" text,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "schedule_item_run_status_ck" CHECK ("schedule_item_run"."status" in ('started','finished','not_triggered','skipped_disabled','held','start_requested','cancelled','skipped_on_resume','failed_to_start','lost'))
);
--> statement-breakpoint
CREATE TABLE "schedule_occurrence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runtime_schedule_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"fired_at" timestamp with time zone,
	"origin" text DEFAULT 'on_time' NOT NULL,
	CONSTRAINT "schedule_occurrence_origin_ck" CHECK ("schedule_occurrence"."origin" in ('on_time','late','resume'))
);
--> statement-breakpoint
ALTER TABLE "work_center" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "runtime_history" ADD COLUMN "schedule_label" text;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "schedule_item_run_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "schedule_label" text;--> statement-breakpoint
ALTER TABLE "api_client" ADD CONSTRAINT "api_client_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_schedule" ADD CONSTRAINT "master_schedule_work_center_id_work_center_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_center"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_schedule" ADD CONSTRAINT "master_schedule_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_schedule" ADD CONSTRAINT "master_schedule_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_schedule_item" ADD CONSTRAINT "master_schedule_item_master_schedule_id_master_schedule_id_fk" FOREIGN KEY ("master_schedule_id") REFERENCES "public"."master_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_schedule_item" ADD CONSTRAINT "master_schedule_item_parent_item_id_master_schedule_item_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."master_schedule_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_schedule" ADD CONSTRAINT "runtime_schedule_work_center_id_work_center_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_center"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_schedule" ADD CONSTRAINT "runtime_schedule_master_schedule_id_master_schedule_id_fk" FOREIGN KEY ("master_schedule_id") REFERENCES "public"."master_schedule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_schedule" ADD CONSTRAINT "runtime_schedule_enabled_by_user_app_user_id_fk" FOREIGN KEY ("enabled_by_user") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_schedule_item" ADD CONSTRAINT "runtime_schedule_item_runtime_schedule_id_runtime_schedule_id_fk" FOREIGN KEY ("runtime_schedule_id") REFERENCES "public"."runtime_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_schedule_item" ADD CONSTRAINT "runtime_schedule_item_parent_item_id_runtime_schedule_item_id_fk" FOREIGN KEY ("parent_item_id") REFERENCES "public"."runtime_schedule_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_schedule_item" ADD CONSTRAINT "runtime_schedule_item_disabled_by_app_user_id_fk" FOREIGN KEY ("disabled_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_run" ADD CONSTRAINT "schedule_item_run_occurrence_id_schedule_occurrence_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."schedule_occurrence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_run" ADD CONSTRAINT "schedule_item_run_item_id_runtime_schedule_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."runtime_schedule_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item_run" ADD CONSTRAINT "schedule_item_run_acknowledged_by_app_user_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_occurrence" ADD CONSTRAINT "schedule_occurrence_runtime_schedule_id_runtime_schedule_id_fk" FOREIGN KEY ("runtime_schedule_id") REFERENCES "public"."runtime_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_client_token_hash_uq" ON "api_client" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "master_schedule_wc_name_uq" ON "master_schedule" USING btree ("work_center_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "master_schedule_wc_external_key_uq" ON "master_schedule" USING btree ("work_center_id","external_key");--> statement-breakpoint
CREATE INDEX "master_schedule_item_schedule_idx" ON "master_schedule_item" USING btree ("master_schedule_id");--> statement-breakpoint
CREATE INDEX "master_schedule_item_parent_idx" ON "master_schedule_item" USING btree ("parent_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_schedule_one_live_per_master_uq" ON "runtime_schedule" USING btree ("master_schedule_id") WHERE "runtime_schedule"."status" in ('active','paused');--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_schedule_one_live_per_key_uq" ON "runtime_schedule" USING btree ("work_center_id","external_key") WHERE "runtime_schedule"."status" in ('active','paused') and "runtime_schedule"."external_key" is not null;--> statement-breakpoint
CREATE INDEX "runtime_schedule_key_latest_idx" ON "runtime_schedule" USING btree ("work_center_id","external_key","runtime_number") WHERE "runtime_schedule"."external_key" is not null;--> statement-breakpoint
CREATE INDEX "runtime_schedule_wc_idx" ON "runtime_schedule" USING btree ("work_center_id","status");--> statement-breakpoint
CREATE INDEX "runtime_schedule_due_idx" ON "runtime_schedule" USING btree ("next_fire_at") WHERE "runtime_schedule"."status" = 'active';--> statement-breakpoint
CREATE INDEX "runtime_schedule_event_runtime_idx" ON "runtime_schedule_event" USING btree ("runtime_schedule_id","at");--> statement-breakpoint
CREATE INDEX "runtime_schedule_event_master_idx" ON "runtime_schedule_event" USING btree ("master_schedule_id","at");--> statement-breakpoint
CREATE INDEX "runtime_schedule_item_schedule_idx" ON "runtime_schedule_item" USING btree ("runtime_schedule_id");--> statement-breakpoint
CREATE INDEX "runtime_schedule_item_parent_idx" ON "runtime_schedule_item" USING btree ("parent_item_id");--> statement-breakpoint
CREATE INDEX "runtime_schedule_item_workflow_idx" ON "runtime_schedule_item" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_item_run_occ_item_uq" ON "schedule_item_run" USING btree ("occurrence_id","item_id");--> statement-breakpoint
CREATE INDEX "schedule_item_run_started_idx" ON "schedule_item_run" USING btree ("status") WHERE "schedule_item_run"."status" = 'started';--> statement-breakpoint
CREATE INDEX "schedule_item_run_start_requested_idx" ON "schedule_item_run" USING btree ("created_at") WHERE "schedule_item_run"."status" = 'start_requested';--> statement-breakpoint
CREATE INDEX "schedule_item_run_instance_idx" ON "schedule_item_run" USING btree ("workflow_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_occurrence_slot_uq" ON "schedule_occurrence" USING btree ("runtime_schedule_id","scheduled_at");