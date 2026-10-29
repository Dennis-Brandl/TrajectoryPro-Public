-- Rebrand wave 3a. "Mission Commander" named both the application and this per-work-center
-- privilege; wave 1 renamed the DISPLAY to "Mission System Commander" and left the column.
-- This closes the collision. Rename only — no type, default, or nullability change, so no
-- backfill and no data at risk.
ALTER TABLE "work_center_user" RENAME COLUMN "mission_commander" TO "mission_system_commander";
