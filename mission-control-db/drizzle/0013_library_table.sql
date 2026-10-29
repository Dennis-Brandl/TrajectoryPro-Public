CREATE TABLE "library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_name_unique" UNIQUE("name")
);
--> statement-breakpoint
INSERT INTO "library" ("name") VALUES ('Default');
--> statement-breakpoint
INSERT INTO "library" ("name")
SELECT DISTINCT "library_name" FROM "workflow" WHERE "library_name" IS NOT NULL
UNION
SELECT DISTINCT "library_name" FROM "environment_spec" WHERE "library_name" IS NOT NULL
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "library_id" uuid;
--> statement-breakpoint
UPDATE "workflow" SET "library_id" = (
	SELECT "id" FROM "library" WHERE "library"."name" = COALESCE("workflow"."library_name", 'Default')
);
--> statement-breakpoint
ALTER TABLE "workflow" ALTER COLUMN "library_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_library_id_library_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."library"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
DROP INDEX "workflow_lineage_idx";
--> statement-breakpoint
ALTER TABLE "workflow" DROP COLUMN "library_name";
--> statement-breakpoint
CREATE INDEX "workflow_lineage_idx" ON "workflow" USING btree ("library_id","name");
--> statement-breakpoint
ALTER TABLE "environment_spec" ADD COLUMN "library_id" uuid;
--> statement-breakpoint
UPDATE "environment_spec" SET "library_id" = (
	SELECT "id" FROM "library" WHERE "library"."name" = COALESCE("environment_spec"."library_name", 'Default')
);
--> statement-breakpoint
ALTER TABLE "environment_spec" ALTER COLUMN "library_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "environment_spec" ADD CONSTRAINT "environment_spec_library_id_library_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."library"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
DROP INDEX "environment_spec_lineage_idx";
--> statement-breakpoint
ALTER TABLE "environment_spec" DROP COLUMN "library_name";
--> statement-breakpoint
CREATE INDEX "environment_spec_lineage_idx" ON "environment_spec" USING btree ("library_id","name");
