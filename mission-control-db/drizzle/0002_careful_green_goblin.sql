CREATE TABLE IF NOT EXISTS "work_center_user" (
	"work_center_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_center_user_work_center_id_user_id_pk" PRIMARY KEY("work_center_id","user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_center_user" ADD CONSTRAINT "work_center_user_work_center_id_work_center_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_center"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_center_user" ADD CONSTRAINT "work_center_user_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
