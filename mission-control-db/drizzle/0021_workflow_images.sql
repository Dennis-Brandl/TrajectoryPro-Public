CREATE TABLE "workflow_image" (
	"workflow_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"data_base64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_image_pk" PRIMARY KEY("workflow_id","filename")
);
--> statement-breakpoint
ALTER TABLE "workflow_image" ADD CONSTRAINT "workflow_image_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;
