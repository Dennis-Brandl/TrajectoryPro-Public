-- M6: artifacts belong to a work center, not a library.
-- Spec: docs/superpowers/specs/2026-07-27-command-module-work-center-direct-load-design.md §10
--
-- DESTRUCTIVE BY DESIGN. work_center_id is NOT NULL and existing artifacts have no work
-- center to inherit, so they are discarded here. Packages are re-loaded from their files.
-- There is no backwards-compatibility requirement for this release. The CASCADE also takes
-- every dependent execution-history row with it: workflow_instance, step_instance,
-- instance_assignment, trace_entry, schedule, schedule_run, and trigger_condition are all
-- wiped too — the same "includes execution history and cannot be undone" destruction the
-- product's own delete-work-center confirmation dialog warns a steward about.
TRUNCATE TABLE workflow, environment_spec CASCADE;
--> statement-breakpoint
-- work_center_role (0006_work_center_role_view.sql) reads through the link tables being
-- dropped below; it is recreated further down against the new workflow_allowed_role shape.
DROP VIEW IF EXISTS work_center_role;
--> statement-breakpoint
DROP TABLE IF EXISTS work_center_workflow_allowed_role;
--> statement-breakpoint
DROP TABLE IF EXISTS work_center_workflow;
--> statement-breakpoint
DROP TABLE IF EXISTS work_center_environment;
--> statement-breakpoint
-- workflow ------------------------------------------------------------------
ALTER TABLE workflow DROP COLUMN library_id;
--> statement-breakpoint
ALTER TABLE workflow DROP CONSTRAINT IF EXISTS workflow_oid_unique;
--> statement-breakpoint
DROP INDEX IF EXISTS workflow_lineage_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS workflow_lineage_source_idx;
--> statement-breakpoint
ALTER TABLE workflow ADD COLUMN work_center_id uuid NOT NULL
  CONSTRAINT workflow_work_center_id_work_center_id_fk REFERENCES work_center(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE workflow ADD COLUMN dispatch_policy text;
--> statement-breakpoint
ALTER TABLE workflow ADD CONSTRAINT workflow_dispatch_ck CHECK (
  dispatch_policy IS NULL OR dispatch_policy IN
  ('least_queued_steps','highest_priority','round_robin','fewest_active_instances','manual'));
--> statement-breakpoint
CREATE UNIQUE INDEX workflow_entry_uq ON workflow (work_center_id, oid, version, state);
--> statement-breakpoint
CREATE UNIQUE INDEX workflow_wc_id_uq ON workflow (work_center_id, id);
--> statement-breakpoint
CREATE INDEX workflow_oid_idx ON workflow (oid);
--> statement-breakpoint
CREATE INDEX workflow_wc_name_idx ON workflow (work_center_id, name);
--> statement-breakpoint
-- environment_spec ----------------------------------------------------------
ALTER TABLE environment_spec DROP COLUMN library_id;
--> statement-breakpoint
ALTER TABLE environment_spec DROP CONSTRAINT IF EXISTS environment_spec_oid_unique;
--> statement-breakpoint
DROP INDEX IF EXISTS environment_spec_lineage_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS environment_spec_lineage_source_idx;
--> statement-breakpoint
ALTER TABLE environment_spec ADD COLUMN work_center_id uuid NOT NULL
  CONSTRAINT environment_spec_work_center_id_work_center_id_fk REFERENCES work_center(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX environment_spec_entry_uq
  ON environment_spec (work_center_id, oid, version, state);
--> statement-breakpoint
CREATE INDEX environment_spec_oid_idx ON environment_spec (oid);
--> statement-breakpoint
CREATE INDEX environment_spec_wc_name_idx ON environment_spec (work_center_id, name);
--> statement-breakpoint
-- allowed roles, re-parented onto the workflow ------------------------------
CREATE TABLE workflow_allowed_role (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      uuid NOT NULL CONSTRAINT workflow_allowed_role_workflow_id_workflow_id_fk
                     REFERENCES workflow(id)      ON DELETE CASCADE,
  workflow_node_id uuid NOT NULL CONSTRAINT workflow_allowed_role_workflow_node_id_workflow_node_id_fk
                     REFERENCES workflow_node(id) ON DELETE CASCADE,
  role_id          uuid NOT NULL CONSTRAINT workflow_allowed_role_role_id_role_id_fk
                     REFERENCES role(id)          ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX workflow_allowed_role_uq
  ON workflow_allowed_role (workflow_id, workflow_node_id, role_id);
--> statement-breakpoint
CREATE INDEX workflow_allowed_role_node_idx ON workflow_allowed_role (workflow_node_id);
--> statement-breakpoint
-- work_center_role, recreated: roles now derive from a workflow's own work center rather
-- than the retired work_center_workflow link row.
CREATE VIEW work_center_role AS
  SELECT DISTINCT wf.work_center_id, ar.role_id
  FROM workflow_allowed_role ar
  JOIN workflow wf ON wf.id = ar.workflow_id;
--> statement-breakpoint
-- composite FKs: an instance's / schedule's work center must match its workflow's --------
ALTER TABLE workflow_instance DROP CONSTRAINT IF EXISTS workflow_instance_workflow_id_workflow_id_fk;
--> statement-breakpoint
ALTER TABLE workflow_instance ADD CONSTRAINT workflow_instance_wc_workflow_fk
  FOREIGN KEY (work_center_id, workflow_id)
  REFERENCES workflow (work_center_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE schedule DROP CONSTRAINT IF EXISTS schedule_workflow_id_workflow_id_fk;
--> statement-breakpoint
ALTER TABLE schedule ADD CONSTRAINT schedule_wc_workflow_fk
  FOREIGN KEY (work_center_id, workflow_id)
  REFERENCES workflow (work_center_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
DROP TABLE library;
