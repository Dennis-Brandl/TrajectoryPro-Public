CREATE TABLE "schedule_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"runtime_schedule_id" uuid,
	"work_center_id" uuid,
	"work_center_name" text NOT NULL,
	"schedule_label" text NOT NULL,
	"schedule_name" text NOT NULL,
	"run_once" boolean DEFAULT false NOT NULL,
	"time_zone" text NOT NULL,
	"occurrence_number" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone NOT NULL,
	"origin" text NOT NULL,
	"workflows" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_occurrence" ADD COLUMN "history_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedule_history" ADD CONSTRAINT "schedule_history_work_center_id_work_center_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_center"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_history_occurrence_uq" ON "schedule_history" USING btree ("occurrence_id");--> statement-breakpoint
CREATE INDEX "schedule_history_wc_idx" ON "schedule_history" USING btree ("work_center_id","finished_at");--> statement-breakpoint
CREATE INDEX "schedule_history_finished_idx" ON "schedule_history" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "schedule_occurrence_unrecorded_idx" ON "schedule_occurrence" USING btree ("fired_at") WHERE "schedule_occurrence"."history_recorded_at" is null;