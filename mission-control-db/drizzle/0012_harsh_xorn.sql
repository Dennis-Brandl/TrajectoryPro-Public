ALTER TABLE "app_user" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "banned" boolean;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "ban_expires" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonatedBy" uuid;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_impersonatedBy_app_user_id_fk" FOREIGN KEY ("impersonatedBy") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "app_user" SET "role" = 'admin' WHERE "access_level" = 'administrator';