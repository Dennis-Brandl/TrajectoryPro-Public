-- Spec 2026-09-06 D6: e-signature audit rows, one per attempt. workflow_instance_id and
-- step_instance_id are soft links (no FK) — see execution.ts's stepSignature comment for why.
CREATE TABLE "step_signature" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_instance_id" uuid NOT NULL,
	"runtime_number" integer NOT NULL,
	"work_center_id" uuid,
	"work_center_name" text NOT NULL,
	"step_instance_id" uuid,
	"step_oid" text NOT NULL,
	"step_name" text NOT NULL,
	"signer_user_id" uuid,
	"signer_login_name" text NOT NULL,
	"signer_display_name" text,
	"role_id" uuid,
	"role_name" text,
	"operator_user_id" uuid,
	"operator_login_name" text NOT NULL,
	"meaning" text,
	"decision" text,
	"outcome" text NOT NULL,
	"failure_code" text,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "step_signature_outcome_ck" CHECK ("step_signature"."outcome" in ('signed','failed'))
);
--> statement-breakpoint
ALTER TABLE "step_signature" ADD CONSTRAINT "step_signature_work_center_id_work_center_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_center"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_signature" ADD CONSTRAINT "step_signature_signer_user_id_app_user_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_signature" ADD CONSTRAINT "step_signature_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_signature" ADD CONSTRAINT "step_signature_operator_user_id_app_user_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "step_signature_instance_idx" ON "step_signature" USING btree ("workflow_instance_id");--> statement-breakpoint
CREATE INDEX "step_signature_wc_signed_idx" ON "step_signature" USING btree ("work_center_id","signed_at" DESC NULLS LAST);