ALTER TABLE "wc_resource" ADD COLUMN "capacity_set_by" uuid;--> statement-breakpoint
ALTER TABLE "wc_resource" ADD COLUMN "capacity_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wc_resource" ADD CONSTRAINT "wc_resource_capacity_set_by_app_user_id_fk" FOREIGN KEY ("capacity_set_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;