CREATE TABLE IF NOT EXISTS "environment_spec" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oid" text NOT NULL,
	"name" text NOT NULL,
	"library_name" text,
	"parent_environment_spec_id" uuid,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"state" text DEFAULT 'Draft' NOT NULL,
	"effective_from" timestamp with time zone,
	"schema_version" text,
	"spec_jsonb" jsonb NOT NULL,
	"source_filename" text,
	"downloaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"downloaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environment_spec_oid_unique" UNIQUE("oid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_environment" (
	"workflow_id" uuid NOT NULL,
	"environment_spec_id" uuid NOT NULL,
	"source" text DEFAULT 'download' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_environment_workflow_id_environment_spec_id_pk" PRIMARY KEY("workflow_id","environment_spec_id"),
	CONSTRAINT "workflow_environment_source_ck" CHECK ("workflow_environment"."source" in ('download','manual'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "environment_spec" ADD CONSTRAINT "environment_spec_parent_environment_spec_id_environment_spec_id_fk" FOREIGN KEY ("parent_environment_spec_id") REFERENCES "public"."environment_spec"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "environment_spec" ADD CONSTRAINT "environment_spec_downloaded_by_app_user_id_fk" FOREIGN KEY ("downloaded_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_environment" ADD CONSTRAINT "workflow_environment_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_environment" ADD CONSTRAINT "workflow_environment_environment_spec_id_environment_spec_id_fk" FOREIGN KEY ("environment_spec_id") REFERENCES "public"."environment_spec"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "environment_spec_lineage_idx" ON "environment_spec" USING btree ("library_name","name");