-- Task 20 (spec 2026-11-08): drops the unused schedule prototype. It never held real work, so any row
-- means something unexpected wrote to it: stop rather than lose it, and inspect by hand.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM schedule) OR EXISTS (SELECT 1 FROM schedule_run) OR EXISTS (SELECT 1 FROM trigger_condition)
     OR EXISTS (SELECT 1 FROM workflow_instance WHERE schedule_id IS NOT NULL) THEN
    RAISE EXCEPTION 'the schedule prototype tables are not empty: manual inspection required before 0049';
  END IF;
END $$;
--> statement-breakpoint
DROP TABLE "schedule" CASCADE;--> statement-breakpoint
DROP TABLE "schedule_run" CASCADE;--> statement-breakpoint
DROP TABLE "trigger_condition" CASCADE;--> statement-breakpoint
ALTER TABLE "workflow_instance" DROP COLUMN "schedule_id";