ALTER TABLE "workflow" ADD COLUMN "source_library_name" text;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "source_library_oid" text;--> statement-breakpoint
ALTER TABLE "environment_spec" ADD COLUMN "source_library_name" text;--> statement-breakpoint
ALTER TABLE "environment_spec" ADD COLUMN "source_library_oid" text;--> statement-breakpoint
CREATE INDEX "workflow_lineage_source_idx" ON "workflow" USING btree ("source_library_oid","name");--> statement-breakpoint
CREATE INDEX "environment_spec_lineage_source_idx" ON "environment_spec" USING btree ("source_library_oid","name");