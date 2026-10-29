CREATE TABLE "workflow_signature_role" (
	"workflow_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "workflow_signature_role_workflow_id_role_id_pk" PRIMARY KEY("workflow_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "workflow_signature_role" ADD CONSTRAINT "workflow_signature_role_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_signature_role" ADD CONSTRAINT "workflow_signature_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_signature_role_role_idx" ON "workflow_signature_role" USING btree ("role_id");--> statement-breakpoint
-- work_center_role, recreated: "roles used in workflows for this work center" now covers both
-- the node-level allowed roles and the e-signature roles named by a workflow's form documents.
DROP VIEW IF EXISTS work_center_role;
--> statement-breakpoint
CREATE VIEW work_center_role AS
  SELECT wf.work_center_id, ar.role_id
  FROM workflow_allowed_role ar
  JOIN workflow wf ON wf.id = ar.workflow_id
  UNION
  SELECT wf.work_center_id, sr.role_id
  FROM workflow_signature_role sr
  JOIN workflow wf ON wf.id = sr.workflow_id;
