-- Spec 2026-10-07: per-work-center runtime workflow ID format. Three config/counter columns
-- on work_center, and a frozen rendered label on the instance plus the two archive tables.
-- Every label column is added nullable, backfilled to the string the row already displays
-- ('RW-' || runtime_number), then constrained — the same shape as 0031. The migration is
-- therefore behaviour-neutral: templates backfill to NULL, so every existing work center
-- keeps rendering RW-<n>.
ALTER TABLE "work_center" ADD COLUMN "runtime_id_template" text;
--> statement-breakpoint
ALTER TABLE "work_center" ADD COLUMN "runtime_seq_bucket" text;
--> statement-breakpoint
ALTER TABLE "work_center" ADD COLUMN "runtime_seq_next" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- CRITICAL. An existing work center keeps the built-in RW-<n>, so its {SEQ} must CONTINUE from
-- the number already issued. Left at the default 1, the first run created after this migration
-- would render 'RW-1' and collide with the backfilled label of the first run ever created here,
-- violating workflow_instance_wc_label_uq below. Setting the bucket to '' (not NULL) is not
-- strictly required — the allocator coalesces NULL to '' — but it makes the invariant visible.
UPDATE "work_center" SET "runtime_seq_next" = "next_runtime_number", "runtime_seq_bucket" = '';
--> statement-breakpoint
ALTER TABLE "workflow_instance" ADD COLUMN "runtime_label" text;
--> statement-breakpoint
UPDATE "workflow_instance" SET "runtime_label" = 'RW-' || "runtime_number" WHERE "runtime_label" IS NULL;
--> statement-breakpoint
ALTER TABLE "workflow_instance" ALTER COLUMN "runtime_label" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "runtime_history" ADD COLUMN "runtime_label" text;
--> statement-breakpoint
UPDATE "runtime_history" SET "runtime_label" = 'RW-' || "runtime_number" WHERE "runtime_label" IS NULL;
--> statement-breakpoint
ALTER TABLE "runtime_history" ALTER COLUMN "runtime_label" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "step_signature" ADD COLUMN "runtime_label" text;
--> statement-breakpoint
UPDATE "step_signature" SET "runtime_label" = 'RW-' || "runtime_number" WHERE "runtime_label" IS NULL;
--> statement-breakpoint
ALTER TABLE "step_signature" ALTER COLUMN "runtime_label" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_instance_wc_label_uq" ON "workflow_instance" ("work_center_id","runtime_label");
