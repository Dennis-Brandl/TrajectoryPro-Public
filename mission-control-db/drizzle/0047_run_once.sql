DROP INDEX "runtime_schedule_one_live_per_master_uq";--> statement-breakpoint
ALTER TABLE "runtime_schedule" ADD COLUMN "run_once" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_schedule" ADD COLUMN "run_once_request_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_schedule_run_once_request_uq" ON "runtime_schedule" USING btree ("master_schedule_id","run_once_request_id") WHERE "runtime_schedule"."run_once_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_schedule_one_live_per_master_uq" ON "runtime_schedule" USING btree ("master_schedule_id") WHERE "runtime_schedule"."status" in ('active','paused') and not "runtime_schedule"."run_once";