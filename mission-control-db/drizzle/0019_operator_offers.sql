-- Phase 4a (spec 2026-08-03 §3): instance_assignment reshaped for the offer/claim lifecycle.
-- Precondition: the table must be EMPTY — no writer has ever existed (phase 3 parks UI steps
-- without assignments). Fail visibly rather than guess at data surgery.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM instance_assignment) THEN
    RAISE EXCEPTION 'instance_assignment is not empty: manual inspection required before 0019';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "instance_assignment" ADD COLUMN "preferred_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "instance_assignment" ADD COLUMN "allowed_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "instance_assignment" ADD CONSTRAINT "instance_assignment_preferred_user_id_app_user_id_fk" FOREIGN KEY ("preferred_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "instance_assignment" ALTER COLUMN "status" SET DEFAULT 'offered';
--> statement-breakpoint
ALTER TABLE "instance_assignment" DROP CONSTRAINT "instance_assignment_status_ck";
--> statement-breakpoint
ALTER TABLE "instance_assignment" ADD CONSTRAINT "instance_assignment_status_ck" CHECK ("instance_assignment"."status" in ('offered','claimed','completed','cancelled'));
--> statement-breakpoint
CREATE INDEX "instance_assignment_wc_live_idx" ON "instance_assignment" ("work_center_id","status") WHERE "instance_assignment"."status" IN ('offered','claimed');
--> statement-breakpoint
CREATE UNIQUE INDEX "instance_assignment_step_live_uq" ON "instance_assignment" ("step_instance_id") WHERE "instance_assignment"."status" IN ('offered','claimed');
