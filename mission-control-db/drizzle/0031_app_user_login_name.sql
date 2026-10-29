-- Spec 2026-09-06 D6/D7: app_user.login_name. Added nullable, backfilled from the sanitised
-- email local part (numeric suffix on collisions, ordered by created_at then id), then
-- constrained. The BEFORE INSERT trigger derives the same default for every future row that
-- omits the column (better-auth sign-up, fixtures) — '' is the DEFAULT that lets an insert
-- omit it and the trigger replaces it before the CHECK runs, so '' never persists.
ALTER TABLE "app_user" ADD COLUMN "login_name" text;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_login_name_base(email text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(s) < 2 THEN 'user' ELSE s END FROM (
    SELECT left(regexp_replace(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '-', 'g'), '^[^a-z0-9]+', ''), 60) AS s
  ) t;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_default_login_name() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  base text;
  candidate text;
  n integer := 1;
BEGIN
  IF NEW.login_name IS NULL OR NEW.login_name = '' THEN
    base := app_user_login_name_base(NEW.email);
    candidate := base;
    WHILE EXISTS (SELECT 1 FROM app_user WHERE login_name = candidate) LOOP
      n := n + 1;
      candidate := base || '-' || n;
    END LOOP;
    NEW.login_name := candidate;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  r record;
  base text;
  candidate text;
  n integer;
BEGIN
  FOR r IN SELECT id, email FROM app_user ORDER BY created_at, id LOOP
    base := app_user_login_name_base(r.email);
    candidate := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM app_user WHERE login_name = candidate) LOOP
      n := n + 1;
      candidate := base || '-' || n;
    END LOOP;
    UPDATE app_user SET login_name = candidate WHERE id = r.id;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "app_user" ALTER COLUMN "login_name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_user" ALTER COLUMN "login_name" SET DEFAULT '';
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_login_name_unique" UNIQUE("login_name");
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_login_name_ck" CHECK ("app_user"."login_name" ~ '^[a-z0-9][a-z0-9._-]{1,63}$');
--> statement-breakpoint
CREATE TRIGGER app_user_login_name_default BEFORE INSERT ON "app_user"
  FOR EACH ROW EXECUTE FUNCTION app_user_default_login_name();
