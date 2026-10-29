CREATE TABLE "wc_resource" (
	"work_center_id" uuid NOT NULL,
	"name" text NOT NULL,
	"resource_type" text NOT NULL,
	"use_limit" integer,
	"pool_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"available_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"in_use" integer DEFAULT 0 NOT NULL,
	"description" text,
	"defined_by_env_spec_id" uuid,
	"defined_from_version" text,
	"defined_from_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wc_resource_work_center_id_name_pk" PRIMARY KEY("work_center_id","name"),
	CONSTRAINT "wc_resource_type_ck" CHECK ("wc_resource"."resource_type" in ('binary exclusive use','binary shared use with pool limits','countable use with pool limits','named pool','sync')),
	CONSTRAINT "wc_resource_in_use_ck" CHECK ("wc_resource"."in_use" >= 0)
);
--> statement-breakpoint
CREATE TABLE "wc_resource_holder" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wc_resource_holder_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"work_center_id" uuid NOT NULL,
	"name" text NOT NULL,
	"instance_id" uuid NOT NULL,
	"step_oid" text NOT NULL,
	"amount" integer DEFAULT 1 NOT NULL,
	"held_name" text,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wc_resource_holder_amount_ck" CHECK ("wc_resource_holder"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "wc_resource_waiter" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wc_resource_waiter_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"work_center_id" uuid NOT NULL,
	"name" text NOT NULL,
	"instance_id" uuid NOT NULL,
	"step_oid" text NOT NULL,
	"kind" text NOT NULL,
	"amount" integer,
	"payload" text,
	"granted" boolean DEFAULT false NOT NULL,
	"granted_name" text,
	"granted_payload" text,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wc_resource_waiter_kind_ck" CHECK ("wc_resource_waiter"."kind" in ('acquire','send','receive','sync'))
);
--> statement-breakpoint
CREATE TABLE "wc_value_property" (
	"work_center_id" uuid NOT NULL,
	"property_name" text NOT NULL,
	"entry_name" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"defined_by_env_spec_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "wc_value_property_work_center_id_property_name_entry_name_pk" PRIMARY KEY("work_center_id","property_name","entry_name")
);
--> statement-breakpoint
ALTER TABLE "wc_resource" ADD CONSTRAINT "wc_resource_work_center_id_work_center_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_center"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wc_resource" ADD CONSTRAINT "wc_resource_defined_by_env_spec_id_environment_spec_id_fk" FOREIGN KEY ("defined_by_env_spec_id") REFERENCES "public"."environment_spec"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wc_resource_holder" ADD CONSTRAINT "wc_resource_holder_instance_id_workflow_instance_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wc_resource_holder" ADD CONSTRAINT "wc_resource_holder_resource_fk" FOREIGN KEY ("work_center_id","name") REFERENCES "public"."wc_resource"("work_center_id","name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wc_resource_waiter" ADD CONSTRAINT "wc_resource_waiter_instance_id_workflow_instance_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wc_resource_waiter" ADD CONSTRAINT "wc_resource_waiter_resource_fk" FOREIGN KEY ("work_center_id","name") REFERENCES "public"."wc_resource"("work_center_id","name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wc_value_property" ADD CONSTRAINT "wc_value_property_work_center_id_work_center_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_center"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wc_value_property" ADD CONSTRAINT "wc_value_property_defined_by_env_spec_id_environment_spec_id_fk" FOREIGN KEY ("defined_by_env_spec_id") REFERENCES "public"."environment_spec"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wc_value_property" ADD CONSTRAINT "wc_value_property_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wc_resource_holder_resource_idx" ON "wc_resource_holder" USING btree ("work_center_id","name");--> statement-breakpoint
CREATE INDEX "wc_resource_holder_instance_idx" ON "wc_resource_holder" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "wc_resource_waiter_fifo_idx" ON "wc_resource_waiter" USING btree ("work_center_id","name","id");--> statement-breakpoint
CREATE INDEX "wc_resource_waiter_granted_idx" ON "wc_resource_waiter" USING btree ("instance_id") WHERE "wc_resource_waiter"."granted";