ALTER TABLE "work_center" ADD COLUMN "auto_claim" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "auto_claim" boolean;