// Copyright 2026 Dennis L. Brandl
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// PL/pgSQL trigger functions + trigger definitions ported from SQLite (src/server/lib/db.ts:264–506).
// All 20 invariant triggers. Consumed by ddl.pg.ts to install triggers on schema creation.
//
// Port rules applied:
//   - SELECT RAISE(ABORT,'msg') WHERE (cond)  →  IF (cond) THEN RAISE EXCEPTION 'msg'; END IF;
//   - bare SELECT RAISE(ABORT,'msg');           →  RAISE EXCEPTION 'msg';
//   - SQLite IS NOT <expr>                      →  IS DISTINCT FROM <expr>
//   - SQLite != / !=                            →  <> (NOT IS DISTINCT FROM — preserves NULL semantics)
//   - audit guard: WHERE EXISTS(sqlite_master…) →  IF to_regclass('_trigger_audit') IS NOT NULL THEN … END IF;
//   - strftime('%s','now')*1000                 →  (extract(epoch from now())*1000)::bigint
//   - BEFORE trigger functions                  →  RETURN NEW;
//   - AFTER trigger functions (refcount pair)   →  RETURN NULL;

import { GLOBAL_TEAM_ID } from '@/lib/global-team'

export const TRIGGERS_SQL = `

-- ============================================================
-- C1: library triggers
-- ============================================================

CREATE OR REPLACE FUNCTION "trg_library_immutable_columns"() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'library.id is immutable';
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "library_immutable_columns" ON "library";
CREATE TRIGGER "library_immutable_columns"
  BEFORE UPDATE OF "id" ON "library"
  FOR EACH ROW EXECUTE FUNCTION "trg_library_immutable_columns"();

CREATE OR REPLACE FUNCTION "trg_library_parent_same_team_insert"() RETURNS trigger AS $fn$
BEGIN
  IF (SELECT "id" FROM "library" WHERE "id" = NEW."parentLibraryId") IS NULL THEN
    RAISE EXCEPTION 'parent library does not exist';
  END IF;
  IF (SELECT "teamId" FROM "library" WHERE "id" = NEW."parentLibraryId") IS DISTINCT FROM NEW."teamId" THEN
    RAISE EXCEPTION 'parent library must belong to same team';
  END IF;
  IF to_regclass('_trigger_audit') IS NOT NULL THEN
    INSERT INTO "_trigger_audit" ("triggerName","firedAt")
      VALUES ('library_parent_same_team_insert', (extract(epoch from now())*1000)::bigint);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "library_parent_same_team_insert" ON "library";
CREATE TRIGGER "library_parent_same_team_insert"
  BEFORE INSERT ON "library"
  FOR EACH ROW WHEN (NEW."parentLibraryId" IS NOT NULL)
  EXECUTE FUNCTION "trg_library_parent_same_team_insert"();

CREATE OR REPLACE FUNCTION "trg_library_parent_same_team_update"() RETURNS trigger AS $fn$
BEGIN
  IF (SELECT "id" FROM "library" WHERE "id" = NEW."parentLibraryId") IS NULL THEN
    RAISE EXCEPTION 'parent library does not exist';
  END IF;
  IF (SELECT "teamId" FROM "library" WHERE "id" = NEW."parentLibraryId") IS DISTINCT FROM NEW."teamId" THEN
    RAISE EXCEPTION 'parent library must belong to same team';
  END IF;
  IF to_regclass('_trigger_audit') IS NOT NULL THEN
    INSERT INTO "_trigger_audit" ("triggerName","firedAt")
      VALUES ('library_parent_same_team_update', (extract(epoch from now())*1000)::bigint);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "library_parent_same_team_update" ON "library";
CREATE TRIGGER "library_parent_same_team_update"
  BEFORE UPDATE OF "parentLibraryId" ON "library"
  FOR EACH ROW WHEN (NEW."parentLibraryId" IS NOT NULL)
  EXECUTE FUNCTION "trg_library_parent_same_team_update"();

-- GLOBAL holds action, environment and step libraries only (spec 2026-10-12 U2).
CREATE OR REPLACE FUNCTION "trg_library_global_entity_types"() RETURNS trigger AS $fn$
BEGIN
  IF NEW."teamId" = '${GLOBAL_TEAM_ID}' AND NEW."entityType" = 'workflow' THEN
    RAISE EXCEPTION 'workflow libraries cannot belong to GLOBAL';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "library_global_entity_types" ON "library";
CREATE TRIGGER "library_global_entity_types"
  BEFORE INSERT OR UPDATE OF "teamId", "entityType" ON "library"
  FOR EACH ROW EXECUTE FUNCTION "trg_library_global_entity_types"();

-- ============================================================
-- C2: specification content triggers
-- ============================================================

CREATE OR REPLACE FUNCTION "trg_spec_root_consistency_insert"() RETURNS trigger AS $fn$
BEGIN
  IF (SELECT "rootSpecificationId" FROM "specification" WHERE "id" = NEW."parentSpecificationId") IS NULL THEN
    RAISE EXCEPTION 'parent specification does not exist';
  END IF;
  IF (SELECT "rootSpecificationId" FROM "specification" WHERE "id" = NEW."parentSpecificationId")
      IS DISTINCT FROM NEW."rootSpecificationId" THEN
    RAISE EXCEPTION 'child rootSpecificationId mismatch';
  END IF;
  IF to_regclass('_trigger_audit') IS NOT NULL THEN
    INSERT INTO "_trigger_audit" ("triggerName","firedAt")
      VALUES ('spec_root_consistency_insert', (extract(epoch from now())*1000)::bigint);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "spec_root_consistency_insert" ON "specification";
CREATE TRIGGER "spec_root_consistency_insert"
  BEFORE INSERT ON "specification"
  FOR EACH ROW WHEN (NEW."parentSpecificationId" IS NOT NULL)
  EXECUTE FUNCTION "trg_spec_root_consistency_insert"();

CREATE OR REPLACE FUNCTION "trg_spec_no_cross_tree_reparent"() RETURNS trigger AS $fn$
BEGIN
  IF (SELECT "rootSpecificationId" FROM "specification" WHERE "id" = NEW."parentSpecificationId") IS NULL THEN
    RAISE EXCEPTION 'parent specification does not exist';
  END IF;
  IF (SELECT "rootSpecificationId" FROM "specification" WHERE "id" = NEW."parentSpecificationId")
      IS DISTINCT FROM NEW."rootSpecificationId" THEN
    RAISE EXCEPTION 'cannot reparent across trees';
  END IF;
  IF to_regclass('_trigger_audit') IS NOT NULL THEN
    INSERT INTO "_trigger_audit" ("triggerName","firedAt")
      VALUES ('spec_no_cross_tree_reparent', (extract(epoch from now())*1000)::bigint);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "spec_no_cross_tree_reparent" ON "specification";
CREATE TRIGGER "spec_no_cross_tree_reparent"
  BEFORE UPDATE OF "parentSpecificationId" ON "specification"
  FOR EACH ROW WHEN (NEW."parentSpecificationId" IS NOT NULL)
  EXECUTE FUNCTION "trg_spec_no_cross_tree_reparent"();

CREATE OR REPLACE FUNCTION "trg_specification_immutable_columns"() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'specification.id/libraryId/rootSpecificationId are immutable';
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "specification_immutable_columns" ON "specification";
CREATE TRIGGER "specification_immutable_columns"
  BEFORE UPDATE OF "id", "libraryId", "rootSpecificationId" ON "specification"
  FOR EACH ROW EXECUTE FUNCTION "trg_specification_immutable_columns"();

-- ============================================================
-- C4: proxy_reference triggers
-- ============================================================

CREATE OR REPLACE FUNCTION "trg_proxy_ref_same_tree_insert"() RETURNS trigger AS $fn$
BEGIN
  IF (SELECT "rootSpecificationId" FROM "specification" WHERE "id" = NEW."targetSpecificationId") IS NULL THEN
    RAISE EXCEPTION 'proxy reference: target spec does not exist';
  END IF;
  IF (SELECT "rootSpecificationId" FROM "specification" WHERE "id" = NEW."parentSpecificationId") IS NULL THEN
    RAISE EXCEPTION 'proxy reference: parent spec does not exist';
  END IF;
  IF (SELECT "rootSpecificationId" FROM "specification" WHERE "id" = NEW."parentSpecificationId")
      IS DISTINCT FROM (SELECT "rootSpecificationId" FROM "specification" WHERE "id" = NEW."targetSpecificationId") THEN
    RAISE EXCEPTION 'proxy reference crosses trees';
  END IF;
  IF to_regclass('_trigger_audit') IS NOT NULL THEN
    INSERT INTO "_trigger_audit" ("triggerName","firedAt")
      VALUES ('proxy_ref_same_tree_insert', (extract(epoch from now())*1000)::bigint);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "proxy_ref_same_tree_insert" ON "proxy_reference";
CREATE TRIGGER "proxy_ref_same_tree_insert"
  BEFORE INSERT ON "proxy_reference"
  FOR EACH ROW EXECUTE FUNCTION "trg_proxy_ref_same_tree_insert"();

CREATE OR REPLACE FUNCTION "trg_proxy_ref_same_tree_update"() RETURNS trigger AS $fn$
BEGIN
  IF (SELECT "rootSpecificationId" FROM "specification" WHERE "id" = NEW."targetSpecificationId") IS NULL THEN
    RAISE EXCEPTION 'proxy reference: target spec does not exist';
  END IF;
  IF (SELECT "rootSpecificationId" FROM "specification" WHERE "id" = NEW."parentSpecificationId") IS NULL THEN
    RAISE EXCEPTION 'proxy reference: parent spec does not exist';
  END IF;
  IF (SELECT "rootSpecificationId" FROM "specification" WHERE "id" = NEW."parentSpecificationId")
      IS DISTINCT FROM (SELECT "rootSpecificationId" FROM "specification" WHERE "id" = NEW."targetSpecificationId") THEN
    RAISE EXCEPTION 'proxy reference crosses trees';
  END IF;
  IF to_regclass('_trigger_audit') IS NOT NULL THEN
    INSERT INTO "_trigger_audit" ("triggerName","firedAt")
      VALUES ('proxy_ref_same_tree_update', (extract(epoch from now())*1000)::bigint);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "proxy_ref_same_tree_update" ON "proxy_reference";
CREATE TRIGGER "proxy_ref_same_tree_update"
  BEFORE UPDATE OF "parentSpecificationId", "targetSpecificationId" ON "proxy_reference"
  FOR EACH ROW EXECUTE FUNCTION "trg_proxy_ref_same_tree_update"();

-- ============================================================
-- C5: image + image_blob triggers
-- ============================================================

CREATE OR REPLACE FUNCTION "trg_image_immutable_columns"() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'image.specificationId/id/mimeType are immutable';
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "image_immutable_columns" ON "image";
CREATE TRIGGER "image_immutable_columns"
  BEFORE UPDATE OF "specificationId", "id", "mimeType" ON "image"
  FOR EACH ROW EXECUTE FUNCTION "trg_image_immutable_columns"();

CREATE OR REPLACE FUNCTION "trg_image_insert_bumps_blob_refcount"() RETURNS trigger AS $fn$
BEGIN
  UPDATE "image_blob" SET "refCount" = "refCount" + 1 WHERE "contentHash" = NEW."contentHash";
  IF to_regclass('_trigger_audit') IS NOT NULL THEN
    INSERT INTO "_trigger_audit" ("triggerName","firedAt")
      VALUES ('image_insert_bumps_blob_refcount', (extract(epoch from now())*1000)::bigint);
  END IF;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "image_insert_bumps_blob_refcount" ON "image";
CREATE TRIGGER "image_insert_bumps_blob_refcount"
  AFTER INSERT ON "image"
  FOR EACH ROW EXECUTE FUNCTION "trg_image_insert_bumps_blob_refcount"();

CREATE OR REPLACE FUNCTION "trg_image_delete_bumps_blob_refcount"() RETURNS trigger AS $fn$
BEGIN
  UPDATE "image_blob" SET "refCount" = "refCount" - 1 WHERE "contentHash" = OLD."contentHash";
  DELETE FROM "image_blob" WHERE "contentHash" = OLD."contentHash" AND "refCount" <= 0;
  IF to_regclass('_trigger_audit') IS NOT NULL THEN
    INSERT INTO "_trigger_audit" ("triggerName","firedAt")
      VALUES ('image_delete_bumps_blob_refcount', (extract(epoch from now())*1000)::bigint);
  END IF;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "image_delete_bumps_blob_refcount" ON "image";
CREATE TRIGGER "image_delete_bumps_blob_refcount"
  AFTER DELETE ON "image"
  FOR EACH ROW EXECUTE FUNCTION "trg_image_delete_bumps_blob_refcount"();

CREATE OR REPLACE FUNCTION "trg_image_blob_immutable"() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'image_blob is content-addressed and immutable; only refCount may change';
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "image_blob_immutable" ON "image_blob";
CREATE TRIGGER "image_blob_immutable"
  BEFORE UPDATE OF "contentHash", "data", "mimeType", "byteSize", "createdAt" ON "image_blob"
  FOR EACH ROW EXECUTE FUNCTION "trg_image_blob_immutable"();

-- ============================================================
-- C6: image_reference immutability
-- ============================================================

CREATE OR REPLACE FUNCTION "trg_image_ref_immutable"() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'image_reference rows are immutable; delete and re-insert';
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "image_ref_immutable" ON "image_reference";
CREATE TRIGGER "image_ref_immutable"
  BEFORE UPDATE ON "image_reference"
  FOR EACH ROW EXECUTE FUNCTION "trg_image_ref_immutable"();

-- ============================================================
-- C7: library_environment triggers
-- ============================================================

CREATE OR REPLACE FUNCTION "trg_libenv_target_must_be_environment"() RETURNS trigger AS $fn$
BEGIN
  IF (SELECT "entityType" FROM "library" WHERE "id" = NEW."environmentLibraryId") <> 'environment' THEN
    RAISE EXCEPTION 'environmentLibraryId must reference an environment library';
  END IF;
  IF to_regclass('_trigger_audit') IS NOT NULL THEN
    INSERT INTO "_trigger_audit" ("triggerName","firedAt")
      VALUES ('libenv_target_must_be_environment', (extract(epoch from now())*1000)::bigint);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "libenv_target_must_be_environment" ON "library_environment";
CREATE TRIGGER "libenv_target_must_be_environment"
  BEFORE INSERT ON "library_environment"
  FOR EACH ROW EXECUTE FUNCTION "trg_libenv_target_must_be_environment"();

CREATE OR REPLACE FUNCTION "trg_libenv_same_team"() RETURNS trigger AS $fn$
BEGIN
  IF (SELECT "teamId" FROM "library" WHERE "id" = NEW."environmentLibraryId")
      IS DISTINCT FROM (SELECT "teamId" FROM "library" WHERE "id" = NEW."libraryId")
     AND (SELECT "teamId" FROM "library" WHERE "id" = NEW."environmentLibraryId") IS DISTINCT FROM '${GLOBAL_TEAM_ID}' THEN
    RAISE EXCEPTION 'environment library must belong to the same team';
  END IF;
  IF to_regclass('_trigger_audit') IS NOT NULL THEN
    INSERT INTO "_trigger_audit" ("triggerName","firedAt")
      VALUES ('libenv_same_team', (extract(epoch from now())*1000)::bigint);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "libenv_same_team" ON "library_environment";
CREATE TRIGGER "libenv_same_team"
  BEFORE INSERT ON "library_environment"
  FOR EACH ROW EXECUTE FUNCTION "trg_libenv_same_team"();

CREATE OR REPLACE FUNCTION "trg_libenv_immutable"() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'library_environment rows are immutable; delete and re-insert';
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "libenv_immutable" ON "library_environment";
CREATE TRIGGER "libenv_immutable"
  BEFORE UPDATE ON "library_environment"
  FOR EACH ROW EXECUTE FUNCTION "trg_libenv_immutable"();

-- ============================================================
-- C8: specification_environment triggers
-- ============================================================

CREATE OR REPLACE FUNCTION "trg_specenv_target_must_be_environment"() RETURNS trigger AS $fn$
BEGIN
  IF (SELECT "entityType" FROM "library" WHERE "id" = NEW."environmentLibraryId") <> 'environment' THEN
    RAISE EXCEPTION 'environmentLibraryId must reference an environment library';
  END IF;
  IF to_regclass('_trigger_audit') IS NOT NULL THEN
    INSERT INTO "_trigger_audit" ("triggerName","firedAt")
      VALUES ('specenv_target_must_be_environment', (extract(epoch from now())*1000)::bigint);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "specenv_target_must_be_environment" ON "specification_environment";
CREATE TRIGGER "specenv_target_must_be_environment"
  BEFORE INSERT ON "specification_environment"
  FOR EACH ROW EXECUTE FUNCTION "trg_specenv_target_must_be_environment"();

CREATE OR REPLACE FUNCTION "trg_specenv_root_only"() RETURNS trigger AS $fn$
BEGIN
  IF (SELECT "parentSpecificationId" FROM "specification" WHERE "id" = NEW."specificationId") IS NOT NULL THEN
    RAISE EXCEPTION 'environment overrides allowed on root specs only';
  END IF;
  IF to_regclass('_trigger_audit') IS NOT NULL THEN
    INSERT INTO "_trigger_audit" ("triggerName","firedAt")
      VALUES ('specenv_root_only', (extract(epoch from now())*1000)::bigint);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "specenv_root_only" ON "specification_environment";
CREATE TRIGGER "specenv_root_only"
  BEFORE INSERT ON "specification_environment"
  FOR EACH ROW EXECUTE FUNCTION "trg_specenv_root_only"();

CREATE OR REPLACE FUNCTION "trg_specenv_same_team"() RETURNS trigger AS $fn$
BEGIN
  IF (SELECT "teamId" FROM "library" WHERE "id" = NEW."environmentLibraryId")
      IS DISTINCT FROM (SELECT l."teamId" FROM "specification" s JOIN "library" l ON l."id" = s."libraryId" WHERE s."id" = NEW."specificationId")
     AND (SELECT "teamId" FROM "library" WHERE "id" = NEW."environmentLibraryId") IS DISTINCT FROM '${GLOBAL_TEAM_ID}' THEN
    RAISE EXCEPTION 'environment library must belong to the same team';
  END IF;
  IF to_regclass('_trigger_audit') IS NOT NULL THEN
    INSERT INTO "_trigger_audit" ("triggerName","firedAt")
      VALUES ('specenv_same_team', (extract(epoch from now())*1000)::bigint);
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "specenv_same_team" ON "specification_environment";
CREATE TRIGGER "specenv_same_team"
  BEFORE INSERT ON "specification_environment"
  FOR EACH ROW EXECUTE FUNCTION "trg_specenv_same_team"();

CREATE OR REPLACE FUNCTION "trg_specenv_immutable"() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'specification_environment rows are immutable; delete and re-insert';
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "specenv_immutable" ON "specification_environment";
CREATE TRIGGER "specenv_immutable"
  BEFORE UPDATE ON "specification_environment"
  FOR EACH ROW EXECUTE FUNCTION "trg_specenv_immutable"();

`
