CREATE TABLE IF NOT EXISTS "workflow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oid" text NOT NULL,
	"name" text NOT NULL,
	"library_name" text,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"state" text DEFAULT 'Draft' NOT NULL,
	"effective_from" timestamp with time zone,
	"schema_version" text,
	"spec_jsonb" jsonb NOT NULL,
	"source_filename" text,
	"checksum" text,
	"downloaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"downloaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_oid_unique" UNIQUE("oid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_node" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"node_oid" text NOT NULL,
	"parent_node_id" uuid,
	"parent_child_spec_oid" text,
	"name" text NOT NULL,
	"version" text,
	"state" text,
	"depth" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_ui_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"owning_node_id" uuid NOT NULL,
	"step_oid" text NOT NULL,
	"name" text,
	"step_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow" ADD CONSTRAINT "workflow_downloaded_by_app_user_id_fk" FOREIGN KEY ("downloaded_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_node" ADD CONSTRAINT "workflow_node_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_node" ADD CONSTRAINT "workflow_node_parent_node_id_workflow_node_id_fk" FOREIGN KEY ("parent_node_id") REFERENCES "public"."workflow_node"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_ui_step" ADD CONSTRAINT "workflow_ui_step_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_ui_step" ADD CONSTRAINT "workflow_ui_step_owning_node_id_workflow_node_id_fk" FOREIGN KEY ("owning_node_id") REFERENCES "public"."workflow_node"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_lineage_idx" ON "workflow" USING btree ("library_name","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_node_oid_uq" ON "workflow_node" USING btree ("workflow_id","node_oid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_node_workflow_idx" ON "workflow_node" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_node_parent_idx" ON "workflow_node" USING btree ("parent_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_ui_step_uq" ON "workflow_ui_step" USING btree ("workflow_id","step_oid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_ui_step_node_idx" ON "workflow_ui_step" USING btree ("owning_node_id");