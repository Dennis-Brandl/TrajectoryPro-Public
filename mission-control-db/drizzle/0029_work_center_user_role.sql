CREATE TABLE "work_center_user_role" (
	"work_center_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_center_user_role_work_center_id_user_id_role_id_pk" PRIMARY KEY("work_center_id","user_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "work_center_user_role" ADD CONSTRAINT "work_center_user_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_center_user_role" ADD CONSTRAINT "work_center_user_role_member_fk" FOREIGN KEY ("work_center_id","user_id") REFERENCES "public"."work_center_user"("work_center_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_center_user_role_role_idx" ON "work_center_user_role" USING btree ("role_id");--> statement-breakpoint
-- Spec 2026-09-06 D2: behaviour-preserving fan-out. Today's eligibility is
-- member(W,U) AND global role(U,R); materialising exactly those pairs leaves every
-- claim/offer/chain outcome unchanged. Global roles held by users in no work center
-- never matched anything and are dropped. user_role itself is dropped in 0030.
INSERT INTO "work_center_user_role" ("work_center_id", "user_id", "role_id", "assigned_at")
SELECT wcu."work_center_id", ur."user_id", ur."role_id", ur."assigned_at"
FROM "user_role" ur
JOIN "work_center_user" wcu ON wcu."user_id" = ur."user_id"
ON CONFLICT DO NOTHING;
