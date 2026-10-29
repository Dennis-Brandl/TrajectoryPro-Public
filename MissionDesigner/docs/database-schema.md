# Database Schema

Reference for the Mission Designer server database.

## Engine & ORM

- **Engine:** PostgreSQL via `pg`
- **ORM:** Drizzle — but note that `schema.ts` is **not** the runtime source of truth. The database is created by the raw SQL in `src/server/lib/db.ts`; Drizzle's schema is used only for typed queries. Any table / column / index / trigger that exists only in `schema.ts` and not in `db.ts` does not exist at runtime.
- **Schema source:** `src/server/db/schema.ts` (Drizzle type definitions, query-side only)
- **Runtime init:** `src/server/lib/db.ts` (raw SQL + `EXPECTED_SCHEMA` column validation)
- **Pragmas:** `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=NORMAL`, `cache_size=-64000`, `mmap_size=30000000`, `temp_store=MEMORY`

### Startup side-effects (`src/server/lib/db.ts:717-748`)

1. `checkDatabaseSchema(true)` — compares every table in `EXPECTED_SCHEMA` against live columns; auto-fixes drift on startup.
2. One-time migration of legacy `library.changeHistory` rows from free-form text to JSON arrays.
3. Wipes all sessions on startup unless `KEEP_SESSIONS_ON_RESTART=true`.

Neither `EXPECTED_SCHEMA` nor `checkDatabaseSchema` verifies indexes — only columns are checked. Trust `db.ts` for the true index set, not `schema.ts`.

### Historical note — OCC removed

Row-level OCC (`rowVersion` columns on `library`, `specification`, etc., plus paired `*_row_version_bump` triggers and a post-commit re-read step in `batchSave`) was implemented in earlier phases and then **removed in Phase 3b**. No `rowVersion` column exists on any table; no bump triggers exist; `src/server/db/__tests__/schema-v2.test.ts:43,56` asserts their absence. Client-side conflict handling now uses `specificationStore.unsavedNewIds: Set<string>` and server 409 responses, not version columns.

Dev/test builds additionally create `_trigger_audit(triggerName, firedAt)` with index `_trigger_audit_name_idx` (see `src/server/db/triggerAudit.ts`). The table is gated by `NODE_ENV !== 'production'`; every trigger contains a `WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE name = '_trigger_audit')` guard so audit inserts are no-ops in production.

---

## Tables

All timestamp columns are integer `Unix epoch milliseconds`. Booleans are `integer` with 0/1.

### `user`

| Column              | Type           | Constraints      |
| ------------------- | -------------- | ---------------- |
| id                  | text           | PK               |
| name                | text           | nullable         |
| email               | text           | NOT NULL, UNIQUE |
| emailVerified       | integer (bool) | nullable         |
| image               | text           | nullable         |
| isAdministrator     | integer (bool) | default `false`  |
| isGlobal            | integer (bool) | default `false`  |
| isWorkflowAuthor    | integer (bool) | default `true`   |
| isStepLibraryAuthor | integer (bool) | default `false`  |
| isEnvironmentAuthor | integer (bool) | default `false`  |
| isActionAuthor      | integer (bool) | default `false`  |
| createdAt           | integer        | nullable         |
| updatedAt           | integer        | nullable         |

Indexes: `user_email_unique(email)`.

### `session`

| Column    | Type    | Constraints                    |
| --------- | ------- | ------------------------------ |
| id        | text    | PK                             |
| userId    | text    | NOT NULL, FK→`user.id` CASCADE |
| token     | text    | NOT NULL, UNIQUE               |
| expiresAt | integer | NOT NULL                       |
| ipAddress | text    | nullable                       |
| userAgent | text    | nullable                       |
| createdAt | integer | nullable                       |
| updatedAt | integer | nullable                       |

Indexes: `session_token_unique(token)`.

### `account`

| Column                | Type    | Constraints                    |
| --------------------- | ------- | ------------------------------ |
| id                    | text    | PK                             |
| userId                | text    | NOT NULL, FK→`user.id` CASCADE |
| accountId             | text    | NOT NULL                       |
| providerId            | text    | NOT NULL                       |
| accessToken           | text    | nullable                       |
| refreshToken          | text    | nullable                       |
| accessTokenExpiresAt  | integer | nullable                       |
| refreshTokenExpiresAt | integer | nullable                       |
| scope                 | text    | nullable                       |
| idToken               | text    | nullable                       |
| password              | text    | nullable                       |
| createdAt             | integer | nullable                       |
| updatedAt             | integer | nullable                       |

### `verification`

| Column     | Type    | Constraints |
| ---------- | ------- | ----------- |
| id         | text    | PK          |
| identifier | text    | NOT NULL    |
| value      | text    | NOT NULL    |
| expiresAt  | integer | NOT NULL    |
| createdAt  | integer | nullable    |
| updatedAt  | integer | nullable    |

### `library`

Holds workflow / step / environment / action libraries. Action libraries may self-nest via `parentLibraryId`.

| Column                | Type           | Constraints                                                  |
| --------------------- | -------------- | ------------------------------------------------------------ |
| id                    | text           | PK                                                           |
| userId                | text           | NOT NULL, FK→`user.id` CASCADE                               |
| parentLibraryId       | text           | nullable, self-ref (action libraries only)                   |
| name                  | text           | NOT NULL                                                     |
| entityType            | text           | NOT NULL — `workflow` \| `step` \| `environment` \| `action` |
| description           | text           | nullable                                                     |
| author                | text           | nullable                                                     |
| changeHistory         | text           | nullable (JSON array or free-form)                           |
| version               | text           | nullable, default `'1.0.0'`                                  |
| environmentLibraryIds | text           | nullable (JSON array)                                        |
| isShared              | integer (bool) | default `false`                                              |
| createdAt             | integer        | NOT NULL                                                     |
| updatedAt             | integer        | NOT NULL                                                     |
| lastEditedByUserId    | text           | nullable, FK→`user.id` RESTRICT                              |
| forkedFromLibraryId   | text           | nullable                                                     |
| forkedFromVersion     | text           | nullable                                                     |
| forkedAt              | integer        | nullable                                                     |

Indexes: UNIQUE `(userId, name, entityType, parentLibraryId)`, `library_parentLibraryId_idx(parentLibraryId)`.

Triggers:

- `library_immutable_columns` — blocks UPDATE of `userId`, `id`, `forkedFromLibraryId`, `forkedFromVersion`, `forkedAt`.
- `library_parent_same_user_insert` / `_update` — when `parentLibraryId` is set, parent must exist and belong to same user.
- `library_unshare_blocked_by_refs` — blocks `isShared` 1→0 if cross-account refs exist in `library_environment` or `specification_environment`.

### `specification`

The workflow document. Each row is a version node in a spec tree.

| Column                | Type    | Constraints                              |
| --------------------- | ------- | ---------------------------------------- |
| id                    | text    | PK                                       |
| libraryId             | text    | NOT NULL, FK→`library.id` CASCADE        |
| name                  | text    | NOT NULL                                 |
| description           | text    | nullable                                 |
| version               | text    | NOT NULL, default `'1.0.0'`              |
| state                 | text    | NOT NULL, default `'Draft'`              |
| data                  | text    | NOT NULL (JSON string of workflow graph) |
| environmentLibraryIds | text    | nullable (JSON array)                    |
| createdAt             | integer | NOT NULL                                 |
| updatedAt             | integer | NOT NULL                                 |
| parentSpecificationId | text    | nullable, self-ref FK CASCADE            |
| rootSpecificationId   | text    | nullable, self-ref FK CASCADE            |
| dataSchemaVersion     | integer | NOT NULL, default `3`                    |
| lastEditedByUserId    | text    | nullable, FK→`user.id` RESTRICT          |

States: `Draft` \| `InTest` \| `InReview` \| `Approved` \| `Effective` \| `Superseded` \| `Obsolete`.

Indexes: UNIQUE `(libraryId, name, version)`, `spec_root_idx(rootSpecificationId)`, `spec_parent_idx(parentSpecificationId)`, `specification_libraryId_idx(libraryId)`.

Triggers:

- `spec_root_consistency_insert` — on INSERT with `parentSpecificationId`, parent must exist and `rootSpecificationId` must match parent's root.
- `spec_no_cross_tree_reparent` — same check on UPDATE of `parentSpecificationId`.
- `specification_immutable_columns` — blocks UPDATE of `id`, `libraryId`, `rootSpecificationId`.

### `child_specification`

Nested child workflows beneath a specification (non-versioned, structural).

| Column                | Type    | Constraints                             |
| --------------------- | ------- | --------------------------------------- |
| id                    | text    | PK                                      |
| parentSpecificationId | text    | NOT NULL, FK→`specification.id` CASCADE |
| parentChildSpecId     | text    | nullable, self-ref FK CASCADE           |
| name                  | text    | NOT NULL                                |
| description           | text    | nullable                                |
| data                  | text    | NOT NULL (JSON string)                  |
| depth                 | integer | NOT NULL, default `1`                   |
| createdAt             | integer | NOT NULL                                |
| updatedAt             | integer | NOT NULL                                |

Indexes: `child_spec_parent_idx`, `child_spec_parent_child_idx`.

Triggers:

- `enforce_child_name_uniqueness` — blocks duplicate `name` under same `parentSpecificationId` when `parentChildSpecId IS NULL`.
- `enforce_child_name_uniqueness_nested` — same, scoped to `(parentSpecificationId, parentChildSpecId)` when nested.

### `image_blob`

Content-addressed binary storage. Multiple `image` rows may share one blob.

| Column      | Type    | Constraints           |
| ----------- | ------- | --------------------- |
| contentHash | text    | PK (SHA-256 hex)      |
| data        | blob    | NOT NULL              |
| mimeType    | text    | NOT NULL              |
| byteSize    | integer | NOT NULL              |
| createdAt   | integer | NOT NULL              |
| refCount    | integer | NOT NULL, default `0` |

Allowed MIME (sniffed via magic bytes, not extension): `image/png`, `image/jpeg`, `image/webp`, `image/gif`.

Indexes: `image_blob_created_idx(createdAt)`.

Triggers:

- `image_blob_immutable` — blocks UPDATE of `contentHash`, `data`, `mimeType`, `byteSize`, `createdAt`.
- `image_insert_bumps_blob_refcount` — INSERT on `image` increments `refCount`.
- `image_delete_bumps_blob_refcount` — DELETE on `image` decrements `refCount`; when `≤ 0`, the blob is deleted.

### `image`

Logical image owned by a specification, pointing at a blob.

| Column          | Type    | Constraints                                    |
| --------------- | ------- | ---------------------------------------------- |
| id              | text    | PK                                             |
| specificationId | text    | NOT NULL, FK→`specification.id` CASCADE        |
| filename        | text    | NOT NULL                                       |
| mimeType        | text    | NOT NULL                                       |
| contentHash     | text    | NOT NULL, FK→`image_blob.contentHash` RESTRICT |
| createdAt       | integer | NOT NULL                                       |

Indexes: UNIQUE `(specificationId, filename)`, `image_contenthash_idx(contentHash)`.

Triggers: `image_immutable_columns` — blocks UPDATE of `specificationId`, `id`, `mimeType`.

### `image_reference`

Many-to-many: spec → image usage (a spec in a tree may reference another spec's image).

| Column          | Type                                |
| --------------- | ----------------------------------- |
| specificationId | text, FK→`specification.id` CASCADE |
| imageId         | text, FK→`image.id` CASCADE         |

PK: `(specificationId, imageId)`. Index: `image_ref_image_idx(imageId)`. Trigger: `image_ref_immutable` blocks all UPDATEs.

Note: `image_reference` INSERT/DELETE does **not** bump `image_blob.refCount`. Blob refcounting is driven exclusively by `image` INSERT/DELETE (`db.ts:374-393`). `image_reference` is a usage pointer owned by the API-pairing invariant (`db.ts:406`), not a storage-GC signal.

### `proxy_reference`

Links a node inside one spec to a target spec embedded at that node (same tree only).

| Column                | Type                                 |
| --------------------- | ------------------------------------ |
| parentSpecificationId | text, FK→`specification.id` CASCADE  |
| nodeId                | text                                 |
| targetSpecificationId | text, FK→`specification.id` RESTRICT |

PK: `(parentSpecificationId, nodeId)`. Index: `proxy_ref_target_idx(targetSpecificationId)`.

Triggers: `proxy_ref_same_tree_insert` / `_update` — parent and target must have the same `rootSpecificationId`.

### `library_environment`

Junction: which environment libraries a library depends on.

| Column               | Type                          |
| -------------------- | ----------------------------- |
| libraryId            | text, FK→`library.id` CASCADE |
| environmentLibraryId | text, FK→`library.id` CASCADE |

PK: `(libraryId, environmentLibraryId)`. Index: `libenv_env_idx(environmentLibraryId)`.

Triggers:

- `libenv_target_must_be_environment` — target library's `entityType` must be `'environment'`.
- `libenv_cross_user_requires_shared` — cross-user refs require target `isShared=1`.
- `libenv_immutable` — blocks all UPDATEs.

### `specification_environment`

Junction: per-root-spec environment overrides.

| Column               | Type                                |
| -------------------- | ----------------------------------- |
| specificationId      | text, FK→`specification.id` CASCADE |
| environmentLibraryId | text, FK→`library.id` CASCADE       |

PK: `(specificationId, environmentLibraryId)`. Index: `specenv_env_idx`.

Triggers:

- `specenv_target_must_be_environment` — target must be environment library.
- `specenv_root_only` — `specificationId` must be a root (`parentSpecificationId IS NULL`).
- `specenv_cross_user_requires_shared` — cross-user refs require target `isShared=1`.
- `specenv_immutable` — blocks all UPDATEs.

---

## Relationship Map

```
user ──┬── session
       ├── account
       └── library ──┬── specification ──┬── child_specification (self-nest)
                     │                   ├── image ── image_blob (ref-counted)
                     │                   ├── image_reference
                     │                   ├── proxy_reference (same-tree only)
                     │                   └── specification_environment → library[environment]
                     ├── (self-ref parentLibraryId, action libs)
                     └── library_environment → library[environment]
```

## Invariants enforced by triggers

- Spec tree integrity: all rows with the same `rootSpecificationId` share a root; reparenting cannot cross trees.
- Proxy references stay within a single spec tree.
- Environment junctions may only target `entityType='environment'` libraries.
- Cross-user references require the target library to be `isShared=1`; un-sharing is blocked while such refs exist.
- Image blobs are immutable and automatically garbage-collected when `refCount` drops to 0. `refCount` is bumped only by `image` INSERT/DELETE — `image_reference` rows do not participate in blob GC.
- Several columns are hard-immutable after insert (`library.userId`, `specification.libraryId/rootSpecificationId`, `image_blob.*`, etc.).

## Key source files

- `src/server/db/schema.ts` — Drizzle schema.
- `src/server/lib/db.ts` — runtime initialization, triggers, `EXPECTED_SCHEMA`.
- `src/server/db/triggerAudit.ts` — dev/test trigger audit.
- `src/server/dao/specReadDao.ts` — spec-tree read model.
