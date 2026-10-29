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

/**
 * Idempotent Postgres DDL for all 18 application tables.
 *
 * Ported from the SQLite DDL in src/server/lib/db.ts with Postgres type mapping:
 *   - auth time columns (createdAt/updatedAt/expiresAt/*ExpiresAt) → timestamptz
 *   - auth booleans (emailVerified, isAdministrator)               → boolean
 *   - app epoch-ms columns (team/library/specification/image*)      → bigint
 *   - counters (refCount/byteSize/dataSchemaVersion/isSeeded)       → integer
 *   - image_blob.data                                               → bytea
 *   - JSON-as-text (data/history/changeHistory/environmentLibraryIds) → text
 *
 * Self-FKs (specification.parentSpecificationId/rootSpecificationId and
 * library.parentLibraryId) are defined inline rather than via ALTER TABLE
 * because Postgres lacks ADD CONSTRAINT IF NOT EXISTS.
 *
 * NOT included: legacy DROP TABLE "child_specification" and the free-text→JSON
 * changeHistory migration — this DDL targets fresh-start databases only.
 */
export const DDL_SQL = `
CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text,
  "email" text NOT NULL,
  "emailVerified" boolean,
  "image" text,
  "isAdministrator" boolean DEFAULT false,
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_unique" ON "user" ("email");

CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "session_token_unique" ON "session" ("token");

CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "accessToken" text,
  "refreshToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "idToken" text,
  "password" text,
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz,
  "updatedAt" timestamptz
);

CREATE TABLE IF NOT EXISTS "team" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "createdAt" bigint NOT NULL,
  "updatedAt" bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "team_name_unique" ON "team" ("name");

CREATE TABLE IF NOT EXISTS "user_team" (
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "teamId" text NOT NULL REFERENCES "team"("id") ON DELETE CASCADE,
  PRIMARY KEY ("userId", "teamId")
);
CREATE INDEX IF NOT EXISTS "user_team_team_idx" ON "user_team" ("teamId");

CREATE TABLE IF NOT EXISTS "role" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "isSeeded" integer DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "role_name_unique" ON "role" ("name");

CREATE TABLE IF NOT EXISTS "role_right" (
  "roleId" text NOT NULL REFERENCES "role"("id") ON DELETE CASCADE,
  "right" text NOT NULL,
  PRIMARY KEY ("roleId", "right")
);

CREATE TABLE IF NOT EXISTS "user_team_role" (
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "teamId" text NOT NULL REFERENCES "team"("id") ON DELETE CASCADE,
  "roleId" text NOT NULL REFERENCES "role"("id") ON DELETE CASCADE,
  PRIMARY KEY ("userId", "teamId", "roleId")
);
CREATE INDEX IF NOT EXISTS "utr_team_idx" ON "user_team_role" ("teamId");
CREATE INDEX IF NOT EXISTS "utr_role_idx" ON "user_team_role" ("roleId");

CREATE TABLE IF NOT EXISTS "app_setting" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "library" (
  "id" text PRIMARY KEY NOT NULL,
  "parentLibraryId" text REFERENCES "library"("id"),
  "name" text NOT NULL,
  "entityType" text NOT NULL,
  "description" text,
  "author" text,
  "changeHistory" text,
  "version" text DEFAULT '1.0.0',
  "environmentLibraryIds" text,
  "createdAt" bigint NOT NULL,
  "updatedAt" bigint NOT NULL,
  "lastEditedByUserId" text REFERENCES "user"("id") ON DELETE SET NULL,
  "teamId" text NOT NULL REFERENCES "team"("id"),
  "createdByUserId" text REFERENCES "user"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "library_teamId_name_entityType_parentLibraryId_unique"
  ON "library" ("teamId", "name", "entityType", "parentLibraryId");
CREATE INDEX IF NOT EXISTS "library_parentLibraryId_idx" ON "library" ("parentLibraryId");
CREATE INDEX IF NOT EXISTS "library_teamId_idx" ON "library" ("teamId");

CREATE TABLE IF NOT EXISTS "specification" (
  "id" text PRIMARY KEY NOT NULL,
  "libraryId" text NOT NULL REFERENCES "library"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "typeName" text,
  "version" text NOT NULL DEFAULT '1.0.0',
  "state" text NOT NULL DEFAULT 'Draft',
  "data" text NOT NULL,
  "environmentLibraryIds" text,
  "createdAt" bigint NOT NULL,
  "updatedAt" bigint NOT NULL,
  "parentSpecificationId" text REFERENCES "specification"("id") ON DELETE CASCADE,
  "rootSpecificationId" text REFERENCES "specification"("id") ON DELETE CASCADE,
  "dataSchemaVersion" integer NOT NULL DEFAULT 3,
  "lastEditedByUserId" text REFERENCES "user"("id") ON DELETE SET NULL,
  "history" text NOT NULL DEFAULT '[]',
  "effectiveFrom" bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS "specification_root_name_unique"
  ON "specification" ("libraryId", "name", "version")
  WHERE "parentSpecificationId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "specification_sibling_name_unique"
  ON "specification" ("parentSpecificationId", "name", "version")
  WHERE "parentSpecificationId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "spec_root_idx" ON "specification" ("rootSpecificationId");
CREATE INDEX IF NOT EXISTS "spec_parent_idx" ON "specification" ("parentSpecificationId");
CREATE INDEX IF NOT EXISTS "specification_libraryId_idx" ON "specification" ("libraryId");

CREATE TABLE IF NOT EXISTS "image_blob" (
  "contentHash" text PRIMARY KEY NOT NULL,
  "data" bytea NOT NULL,
  "mimeType" text NOT NULL,
  "byteSize" integer NOT NULL,
  "createdAt" bigint NOT NULL,
  "refCount" integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "image_blob_created_idx" ON "image_blob" ("createdAt");

CREATE TABLE IF NOT EXISTS "image" (
  "id" text PRIMARY KEY NOT NULL,
  "specificationId" text NOT NULL REFERENCES "specification"("id") ON DELETE CASCADE,
  "filename" text NOT NULL,
  "mimeType" text NOT NULL,
  "contentHash" text NOT NULL REFERENCES "image_blob"("contentHash") ON DELETE RESTRICT,
  "createdAt" bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "image_spec_filename_unique"
  ON "image" ("specificationId", "filename");
CREATE INDEX IF NOT EXISTS "image_contenthash_idx" ON "image" ("contentHash");

CREATE TABLE IF NOT EXISTS "image_reference" (
  "specificationId" text NOT NULL REFERENCES "specification"("id") ON DELETE CASCADE,
  "imageId" text NOT NULL REFERENCES "image"("id") ON DELETE CASCADE,
  PRIMARY KEY ("specificationId", "imageId")
);
CREATE INDEX IF NOT EXISTS "image_ref_image_idx" ON "image_reference" ("imageId");

CREATE TABLE IF NOT EXISTS "proxy_reference" (
  "parentSpecificationId" text NOT NULL REFERENCES "specification"("id") ON DELETE CASCADE,
  "nodeId" text NOT NULL,
  "targetSpecificationId" text NOT NULL REFERENCES "specification"("id") ON DELETE RESTRICT,
  PRIMARY KEY ("parentSpecificationId", "nodeId")
);
CREATE INDEX IF NOT EXISTS "proxy_ref_target_idx" ON "proxy_reference" ("targetSpecificationId");

CREATE TABLE IF NOT EXISTS "library_environment" (
  "libraryId" text NOT NULL REFERENCES "library"("id") ON DELETE CASCADE,
  "environmentLibraryId" text NOT NULL REFERENCES "library"("id") ON DELETE CASCADE,
  PRIMARY KEY ("libraryId", "environmentLibraryId")
);
CREATE INDEX IF NOT EXISTS "libenv_env_idx" ON "library_environment" ("environmentLibraryId");

CREATE TABLE IF NOT EXISTS "specification_environment" (
  "specificationId" text NOT NULL REFERENCES "specification"("id") ON DELETE CASCADE,
  "environmentLibraryId" text NOT NULL REFERENCES "library"("id") ON DELETE CASCADE,
  PRIMARY KEY ("specificationId", "environmentLibraryId")
);
CREATE INDEX IF NOT EXISTS "specenv_env_idx" ON "specification_environment" ("environmentLibraryId");
`
