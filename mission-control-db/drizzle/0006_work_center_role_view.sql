-- Custom SQL migration file, put your code below! --
CREATE VIEW work_center_role AS
  SELECT DISTINCT wcw.work_center_id, ar.role_id
  FROM work_center_workflow_allowed_role ar
  JOIN work_center_workflow wcw ON wcw.id = ar.work_center_workflow_id;
