-- Spec 2026-10-07 §6.2 (corrected 2026-10-08 after the whole-branch review): the allocator's
-- label probe must consult runtime_history as well as workflow_instance on every allocation —
-- re-issuing a label the permanent audit record still holds (e.g. after the engine's sweeper
-- deletes the now-terminal workflow_instance row) would alias two different runs under one
-- identifier in History. runtime_history is permanent and unbounded, so an unindexed probe
-- against it would degrade forever; this NON-unique index is what keeps that lookup indexed.
CREATE INDEX "runtime_history_wc_label_idx" ON "runtime_history" ("work_center_id","runtime_label");
