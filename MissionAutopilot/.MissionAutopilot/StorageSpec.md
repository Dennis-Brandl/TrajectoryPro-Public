# Mission Autopilot — Storage Specification

## Overview

All persistent data lives in a dedicated **PostgreSQL** database, accessed via the `pg` driver (async, connection-pooled). There is no ORM — repositories issue parameterized SQL directly through a shared `Queryable` interface. The database is identified by a single `DATABASE_URL` connection string; there is no `DB_PATH`, no on-disk database file, and no SQLite anywhere in the runtime.

```
postgres://mission:<POSTGRES_PASSWORD>@127.0.0.1:5434/mission_autopilot
```

`<POSTGRES_PASSWORD>` is the random password `scripts/setup-secrets.sh` writes to `.env`; there is no default.

is the dev-mode default (`packages/server/src/index.ts`, used only when the `DATABASE_URL` environment variable is unset). In Docker, `docker-compose.yml` always supplies `DATABASE_URL` explicitly — no default is baked into the server image.

Uploaded `.WFenvir` / `.WFaction` package files are **not** archived to disk. `multer.memoryStorage()` handles every upload route (`packages/server/src/routes/management.ts`, `export-import.ts`); the file bytes are parsed in memory and never written under `/data`. See §4.

---

## 1. Postgres Schema

The schema is created by a single migration, `packages/storage/src/migrations/001-initial-schema.ts`, transcribed verbatim below. Six tables total (`environments`, `actions`, `code_versions`, `instances`, `execution_log`, `settings`), plus the migration-tracking table `_migrations` (§6).

### 1.1 Environments Table

Stores Master Environment Specifications with immutable OIDs from Trajectory MD, plus a lifecycle `state`.

```sql
CREATE TABLE environments (
  oid text PRIMARY KEY,
  local_id text NOT NULL,
  version text NOT NULL,
  last_modified_date text NOT NULL,
  description text,
  schema_version text NOT NULL,

  -- Stored as JSON strings (text columns, not jsonb — parsed/serialized by the repository)
  action_property_specifications text NOT NULL DEFAULT '[]',
  value_property_specifications text NOT NULL DEFAULT '[]',
  resource_property_specifications text NOT NULL DEFAULT '[]',

  imported_at text NOT NULL,
  source_filename text NOT NULL,
  state text NOT NULL DEFAULT 'Draft'
    CHECK (state IN ('Draft','InTest','InReview','Approved','Effective','Superseded','Obsolete'))
);
```

`state` is the `LifecycleState` union (`packages/storage/src/types.ts`): `Draft | InTest | InReview | Approved | Effective | Superseded | Obsolete`. Unlike SQLite, the allowed values are enforced in the database itself via `CHECK`, not just in application code.

### 1.2 Actions Table

Stores Master Action Specifications, each linked to a parent environment, with a real foreign key and a per-action code timeout.

```sql
CREATE TABLE actions (
  oid text PRIMARY KEY,
  environment_oid text NOT NULL REFERENCES environments(oid) ON DELETE CASCADE,
  local_id text NOT NULL,
  version text NOT NULL,
  last_modified_date text NOT NULL,
  description text,
  action_visibility text NOT NULL CHECK (action_visibility IN ('opaque', 'observable')),

  input_parameter_specifications text NOT NULL DEFAULT '[]',
  output_parameter_specifications text NOT NULL DEFAULT '[]',
  property_specifications text NOT NULL DEFAULT '[]',

  timeout_seconds integer DEFAULT NULL,   -- NULL = global default, 0 = disabled, >0 = custom
  state text NOT NULL DEFAULT 'Draft'
    CHECK (state IN ('Draft','InTest','InReview','Approved','Effective','Superseded','Obsolete'))
);

CREATE INDEX idx_actions_environment ON actions(environment_oid);
```

### 1.3 Code Versions Table

Stores versioned Python code for each action+state combination.

```sql
CREATE TABLE code_versions (
  id text PRIMARY KEY,
  action_oid text NOT NULL REFERENCES actions(oid) ON DELETE CASCADE,
  state text NOT NULL,
  version_number integer NOT NULL,
  source_code text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,   -- real boolean, not an 0/1 integer
  created_at text NOT NULL,
  created_by text,
  description text,
  UNIQUE (action_oid, state, version_number)
);

CREATE INDEX idx_code_versions_action_state ON code_versions(action_oid, state);
CREATE INDEX idx_code_versions_active ON code_versions(action_oid, state, is_active)
  WHERE is_active;
```

The partial index's predicate is a bare `WHERE is_active` (Postgres accepts a boolean column directly; SQLite's schema needed `WHERE is_active = 1`).

### 1.4 Instances Table

Stores active and recently completed Runtime Action Instances.

```sql
CREATE TABLE instances (
  runtime_action_instance_id text PRIMARY KEY,
  action_oid text NOT NULL REFERENCES actions(oid),
  environment_oid text NOT NULL REFERENCES environments(oid),
  workflow_instance_id text NOT NULL,
  step_instance_id text NOT NULL,
  step_oid text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('opaque', 'observable')),
  state text NOT NULL,

  input_parameters text NOT NULL DEFAULT '[]',
  output_parameters text NOT NULL DEFAULT '[]',
  state_history text NOT NULL DEFAULT '[]',
  pinned_code_versions text NOT NULL DEFAULT '[]',
  states_with_code_executed text NOT NULL DEFAULT '[]',

  created_at text NOT NULL,
  started_at text,
  completed_at text,

  error text,
  traceback text,               -- full Python traceback, kept separate from the one-line `error`
  is_logged boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_instances_state ON instances(state);
CREATE INDEX idx_instances_action ON instances(action_oid);
CREATE INDEX idx_instances_workflow ON instances(workflow_instance_id);
CREATE INDEX idx_instances_cleanup ON instances(completed_at, is_logged)
  WHERE completed_at IS NOT NULL;
```

`traceback` is new versus the SQLite-era column set: instance errors now carry a short `error` summary plus the full Python traceback as a second field (two-tier error detail), both nullable.

`action_oid` / `environment_oid` reference their parent tables but are **not** `ON DELETE CASCADE` — deleting an environment or action does not silently delete instance history.

### 1.5 Execution Log Table

Rolling log of completed action instance records. The primary key is a Postgres identity column, not SQLite's `AUTOINCREMENT`.

```sql
CREATE TABLE execution_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  runtime_action_instance_id text NOT NULL,
  action_oid text NOT NULL,
  action_name text NOT NULL,
  environment_oid text NOT NULL,
  environment_name text NOT NULL,
  workflow_instance_id text NOT NULL,
  step_oid text NOT NULL,

  input_parameters text NOT NULL DEFAULT '[]',
  output_parameters text NOT NULL DEFAULT '[]',
  states_executed text NOT NULL DEFAULT '[]',
  code_versions_used text NOT NULL DEFAULT '{}',

  started_at text NOT NULL,
  completed_at text NOT NULL,
  duration_ms integer NOT NULL,

  final_status text NOT NULL CHECK (final_status IN ('COMPLETED', 'ABORTED', 'STOPPED')),
  error text
);

CREATE INDEX idx_log_action ON execution_log(action_name);
CREATE INDEX idx_log_environment ON execution_log(environment_oid);
CREATE INDEX idx_log_status ON execution_log(final_status);
CREATE INDEX idx_log_completed ON execution_log(completed_at);
```

`id` is `bigint` (SQLSTATE OID 20). `pg`'s default type parser returns `bigint` values as strings; the storage layer overrides that globally with `pg.types.setTypeParser(20, (v) => Number(v))` in `database.ts` (the "int64 rule" — this container's counts and identity ids all fit safely in a JS `number`). The PGlite test adapter applies the equivalent conversion for values that arrive as native `bigint`.

The old SQLite schema's `idx_log_oldest (id ASC)` index is **deliberately not recreated** — the primary-key btree already serves oldest-first scans (`ORDER BY id ASC`) without a redundant index.

### 1.6 Settings Table

Key/value configuration store, seeded with five rows (one more than the old SQLite schema — `api_key` was added later in the SQLite lineage and is now part of the initial Postgres schema).

```sql
CREATE TABLE settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  default_value text NOT NULL,
  description text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('number', 'string', 'boolean'))
);

INSERT INTO settings (key, value, default_value, description, value_type) VALUES
  ('log_max_size', '10000', '10000', 'Maximum execution log entries before rollover', 'number'),
  ('python_pool_size', '4', '4', 'Number of Python subprocess workers', 'number'),
  ('execution_timeout_ms', '60000', '60000', 'Default timeout for Python code execution per state (ms)', 'number'),
  ('instance_retention_hours', '24', '24', 'Hours to retain completed instance records before cleanup', 'number'),
  ('api_key', '', '', 'API key required on protected routes (X-API-Key header). Empty = open access.', 'string')
ON CONFLICT (key) DO NOTHING;
```

An empty `api_key` means the management and REST APIs are unauthenticated (the server logs a startup warning in that case — see `ArchitectureSpec.md`). Setting `ACTIONS_API_KEY` at boot persists it into this row automatically (`applyApiKeyFromEnv`); it is otherwise editable from the management console like any other setting.

---

## 2. Rolling Log Mechanics

`LogRepository.insert()` (`packages/storage/src/repositories/log.repository.ts`) inserts a row and trims in the same atomic operation — SQL semantics are unchanged from the SQLite version, only the syntax moved to `pg`-style parameters:

```sql
-- Inside one withAtomic() transaction:
INSERT INTO execution_log (...) VALUES (...) RETURNING id;

SELECT COUNT(*)::int AS cnt FROM execution_log;

-- If cnt > max_log_size:
DELETE FROM execution_log
WHERE id IN (
  SELECT id FROM execution_log ORDER BY id ASC LIMIT $1  -- $1 = cnt - max_log_size
);
```

A standalone `LogRepository.trimToSize(maxSize)` runs the same count-then-delete logic outside of an insert, for use when `log_max_size` is lowered via settings (trims immediately rather than waiting for the next insert).

- The `id ASC` scan uses the primary-key btree directly (no separate index needed — see §1.5).
- Insert + trim run inside one `withAtomic()` call, so a crash mid-trim cannot leave the log over its configured max.
- `LogRepository.query()` supports filtering by action OID/name, environment OID/name, final status, and a completed-at date range, with `action_name` / `environment_name` matched via `ILIKE` (case-insensitive substring — Postgres's `LIKE` is case-sensitive, unlike SQLite's default `LIKE`, so `ILIKE` is required to preserve the original case-insensitive behavior the test suite asserts).

---

## 3. Instance Cleanup

`InstanceRepository.cleanup(retentionHours)` (`packages/storage/src/repositories/instance.repository.ts`) deletes completed, already-logged instances older than a retention window. The cutoff is **computed in JavaScript**, not via a Postgres date function:

```typescript
const threshold = new Date(Date.now() - retentionHours * 3600000).toISOString()
await q.query(
  `DELETE FROM instances WHERE completed_at IS NOT NULL AND is_logged AND completed_at < $1`,
  [threshold]
)
```

This is a deliberate simplification from the old SQLite spec's `datetime('now', :retention_interval)` — the threshold timestamp is computed once in Node and passed as a plain string parameter, so the query has no database-side time function to keep in sync between environments.

Active (non-completed) instances are never cleaned up — they persist until they reach a terminal state.

**As of this writing, `cleanup()` is not invoked by any scheduler in `packages/server`** — there is no `setInterval` or cron wiring it up. It exists as a repository capability (covered by `packages/storage/src/__tests__/instance.repository.test.ts`) available to a future periodic caller or an operator-triggered admin action; the earlier "runs every 15 minutes" claim in prior drafts of this document described intended, not implemented, behavior.

---

## 4. Package Upload Handling (no disk archive)

Uploaded `.WFenvir` and `.WFaction` files are parsed and imported **entirely in memory**. Both upload routes (`packages/server/src/routes/management.ts` and `export-import.ts`) configure `multer({ storage: multer.memoryStorage() })` — the request body is buffered in the process, unzipped/parsed, and written into `environments` / `actions` / `code_versions` rows. Nothing is written to `/data` or anywhere else on disk; there is no `uploads/` directory and never has been in the Postgres-era code.

An earlier draft of this specification (and of `DockerSpec.md`) described an `/data/uploads/` archive of every uploaded package, timestamp-prefixed for collision avoidance. That was aspirational and was **never actually implemented** — confirmed by `grep -rn "uploads" packages/server/src` returning no matches. This document no longer describes that archive.

The `/data` mount and its Docker volume (`missionautopilot-data`, see §5) are consequently **vestigial**: the server's `Dockerfile` still creates the mount point and declares `VOLUME ["/data"]` for consistency with the rest of the Mission Suite image family, but nothing under `packages/server` reads or writes it. All durable state lives in Postgres.

---

## 5. Docker Volumes

Two named volumes back the compose stack (`docker-compose.yml`):

```yaml
services:
  mission-autopilot-postgres:
    volumes:
      - missionautopilot-pgdata:/var/lib/postgresql/data
  mission-autopilot-server:
    volumes:
      - missionautopilot-data:/data # vestigial — see §4

volumes:
  missionautopilot-data:
  missionautopilot-pgdata:
```

- **`missionautopilot-pgdata`** is the real system of record — Postgres's own data directory. This is the volume that must survive `docker compose down` for data to persist, and the one to protect before `docker compose down -v`.
- **`missionautopilot-data`** (mounted at `/data` on the server) currently holds nothing (§4). It is reserved for forward compatibility rather than load-bearing.

### 5.1 Backup

Postgres, not a file, is the source of truth, so backup means dumping the database:

```bash
# While the postgres service is running:
docker compose exec mission-autopilot-postgres \
  pg_dump -U mission mission_autopilot > backup.sql

# Restore into a fresh (empty) database:
docker compose exec -T mission-autopilot-postgres \
  psql -U mission mission_autopilot < backup.sql
```

`pg_dump` replaces the old "copy `database.sqlite` while the container is running" guidance outright — there is no single file to copy. A full-volume approach (stop the stack, archive the `missionautopilot-pgdata` volume's contents) also works for cold backups, mirroring the old "stop and copy `/data`" option.

---

## 6. Migration System

Migrations are numbered TypeScript modules under `packages/storage/src/migrations/`, each exporting a `Migration` (`{ name, up(q) }`, `runner.ts`). Currently there is exactly one: `001-initial-schema.ts` (§1).

`runMigrations(q, migrations)` (`packages/storage/src/migrations/runner.ts`):

1. Ensures the tracking table exists:
   ```sql
   CREATE TABLE IF NOT EXISTS _migrations (
     id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
     name text NOT NULL UNIQUE,
     applied_at text NOT NULL
   );
   ```
2. Reads `_migrations` to find which migration names have already run, sorts the supplied migration list by `name` (lexical — hence the zero-padded `NNN-` prefix convention), and filters to the pending ones.
3. Applies each pending migration **in its own `BEGIN`/`COMMIT`** — a failure rolls back only that migration and stops the run; migrations applied earlier in the same call stay committed.

`initializeDatabase(databaseUrl)` (`packages/storage/src/index.ts`) is what `packages/server` actually calls on startup. It wraps `runMigrations` with two additional guarantees:

- **Advisory lock**: before migrating, it takes a session-level Postgres advisory lock (`pg_advisory_lock($1)` with the app-specific key `728501`) on a dedicated client, runs the migrations, then unlocks. This makes concurrent app instances migrating the same database at boot safe — the loser blocks on the lock rather than racing DDL.
- **Fail-fast schema verification**: after migrating, it calls `databaseSchemaStatus(pool)` (`database.ts`), which queries `information_schema.tables` and compares against a hardcoded `EXPECTED_TABLES` list (`environments, actions, code_versions, instances, execution_log, settings, _migrations`). If any table is missing — e.g. a corrupt or partially-migrated database whose `_migrations` row claims success while a table is actually absent — `initializeDatabase` closes the pool and **throws**, refusing to let the server start against an incomplete schema. The same `databaseSchemaStatus` check backs the server's `/health` route (returns 503 with the list of missing tables rather than a false-green TCP port).

---

## 7. Transaction / Atomicity Model

### 7.1 `Queryable` — the shared query surface

```typescript
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>
}
```

Every repository is constructed with a `Queryable` and never imports `pg` directly. `pg.Pool`, a checked-out `pg.PoolClient`, and the PGlite test adapter (`testing.ts`) all satisfy this interface structurally, so the same repository code runs unmodified against the real pool, a transaction-bound client, or an in-memory test database.

### 7.2 `withAtomic` (`database.ts`)

```typescript
export async function withAtomic<T>(q: Queryable, fn: (tx: Queryable) => Promise<T>): Promise<T>
```

- If `q` **is** a `pg.Pool` (checked via `instanceof pg.Pool` — see below), `withAtomic` checks out a client, wraps `fn` in `BEGIN`/`COMMIT`, and rolls back + rethrows on error.
- If `q` is anything else (a `PoolClient` already inside a caller's transaction, or the PGlite single-connection test adapter), `fn` runs directly against it — no nested `BEGIN`.
- Pool detection **must** use `instanceof pg.Pool`, not a duck-typed "has a `.connect()` method" check: a `PoolClient` also exposes `.connect()` (it extends `pg.Client`), so a duck-check would attempt to check out a _second_ client from an already-checked-out one.
- Unlike `better-sqlite3`'s nested savepoints, a nested `withAtomic` call does **not** partially roll back sub-scopes — no call site in this codebase relies on that finer granularity.

Individual repository methods that need atomicity (e.g. `LogRepository.insert`'s insert-then-trim, `InstanceRepository.updateState`'s read-modify-write of `state_history`) call `withAtomic(this.q, ...)` internally.

### 7.3 `createTransactionHelper` (`transaction.ts`) — cross-repository transactions

For operations that touch **multiple** repositories atomically (e.g. package import: environment + its actions in one commit), `createTransactionHelper(pool)` returns a `TransactionRunner`:

```typescript
const txRunner = createTransactionHelper(pool)
await txRunner.inTransaction(async ({ q, repos }) => {
  await repos.environments.create(...)
  await repos.actions.create(...)
  // all statements above share ONE checked-out client inside BEGIN/COMMIT
})
```

`inTransaction` checks out one client, opens `BEGIN`, builds a **fresh set of repository instances bound to that client** (`repos.environments`, `.actions`, `.codeVersions`, `.instances`, `.log`, `.settings`), runs the callback, then `COMMIT`s (or `ROLLBACK`s + rethrows on error), always releasing the client in a `finally`. Callers **must** use `tx.repos` inside the callback — the pool-bound repositories constructed at server startup are a different, non-transactional binding and would escape the transaction. A `createTestTransactionHelper(q)` variant does the same thing over a single PGlite connection with plain `BEGIN`/`COMMIT` SQL (no client checkout, since PGlite is already single-connection).

### 7.4 Helpers for pool-vs-transaction-aware code

- `isPool(q)` — `true` iff `q` is the pool itself (statements auto-commit individually on arbitrary connections).
- `isUniqueViolation(err)` — `true` iff `err.code === '23505'` (Postgres's unique-violation SQLSTATE), used for `ON CONFLICT`-style races.
- Retry-on-conflict logic is legal **only** on the pool path (`isPool(q)` true): inside an open Postgres transaction, an error poisons it (`25P02`, "current transaction is aborted") and every subsequent statement fails, so retrying mid-transaction is a bug, not resilience.

---

## 8. Import CLI (SQLite → Postgres, one-shot)

`scripts/import-sqlite.ts` migrates data out of a pre-Postgres SQLite database file into a fresh Postgres database. It is a standalone script (not part of the running server), driven from the command line:

```bash
npx tsx scripts/import-sqlite.ts <path-to-database.sqlite> <postgres-url>
# or: npm run import-sqlite -- <path-to-database.sqlite> <postgres-url>
```

**What it imports** (`importSqlite()`): `environments`, `actions`, `code_versions` (preserving `version_number` and `is_active` exactly), and the _values_ of a fixed set of known `settings` keys (`log_max_size`, `python_pool_size`, `execution_timeout_ms`, `instance_retention_hours`, `api_key`) — updated in place against the target's already-seeded default rows, not inserted as new rows.

**What it skips by design**: `instances` and `execution_log` are never imported — the old runtime/log state is not carried forward, only durable configuration and content.

**What it refuses**:

- **A non-empty target.** Before writing anything, it counts rows across `environments` + `actions` + `code_versions` in the target Postgres database; if the total is greater than zero it throws and does nothing. There is no merge/overwrite mode — drop and recreate the target database, then re-run.
- **An unmigrated source.** `readSqliteSnapshot()` checks the source SQLite file's own `_migrations` table for four required migration names (`001-initial-schema`, `002-action-timeout`, `003-lifecycle-state`, `004-api-key-setting` — the full migration lineage of the old SQLite-era schema). If any are missing, it throws rather than reading a partially-migrated file; the fix is to start the old (pre-Postgres) container once against that file so it finishes migrating, then re-run the import.

The whole import runs inside one `BEGIN`/`COMMIT` against the target (`main()` wraps `importSqlite()` in a transaction on a dedicated `pg.Client`, rolling back on any error) — a failure partway through leaves the target empty, satisfying the "refuses a non-empty target" invariant on retry.

---

## 9. Test Strategy

Storage has two distinct test tiers, both under `packages/storage`:

- **Unit tests run against PGlite**, an in-memory/embedded Postgres, via `createTestDb()` (`@mission/autopilot-storage/testing`, i.e. `packages/storage/src/testing.ts`). `createTestDb()` spins up a fresh `PGlite` instance, wraps it in the same `Queryable` shape the real pool uses (converting any `bigint` values PGlite returns back to `number`, mirroring the `pg.types.setTypeParser(20, ...)` int64 rule), applies the real `001-initial-schema` migration via the real `runMigrations`, and returns it. Every repository test, and most of `packages/server`'s and `packages/engine`'s test suites, run against this — fast, hermetic, no external Postgres process required, but it is _not_ the real `pg` driver.
- **A real-Postgres smoke suite** (`packages/storage/src/__tests__/real-pg.smoke.test.ts`) exercises the handful of code paths PGlite cannot faithfully stand in for: the `instanceof pg.Pool` branch of `withAtomic`, the real advisory lock, the real `23505` unique-violation retry path, and the real int8/bigint wire parser. It is skipped entirely unless `PG_SMOKE_DATABASE_URL` is set (`describe.skipIf(!URL_ENV)`), and is **destructive** — its `beforeAll` runs `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` against whatever database that URL points at, so it must only ever target a disposable database. Enforced, not just documented: the suite throws at collection time (before any connection) unless the database NAME is suffixed `_smoke` (`assertSmokeDatabaseUrl` in `packages/storage/src/testing.ts`).
- Run via `npm run test:pg`, which first typechecks the smoke file against its own `packages/storage/tsconfig.smoke.json` (kept out of the main `tsconfig.json` project graph and the default `npx vitest run`'s file matching — see `packages/storage/vitest.smoke.config.ts`'s header comment) and then runs it with a dedicated `vitest.smoke.config.ts` that targets the file directly. The typecheck step is a real gate, not decorative — `npm run test:pg` fails on a type error in the smoke file even before Postgres is contacted.

---

## 10. Data Integrity Summary

- **Foreign keys are real database constraints**, not an application-enforced `PRAGMA foreign_keys = ON` (SQLite required opting in per-connection; Postgres enforces `REFERENCES` unconditionally). `actions.environment_oid` and `code_versions.action_oid` are `ON DELETE CASCADE`; `instances.action_oid` / `instances.environment_oid` are plain (non-cascading) references — instance history is not silently deleted when its parent action or environment is removed.
- **Lifecycle and enum-shaped columns are `CHECK`-constrained** at the schema level (`environments.state`, `actions.state`, `actions.action_visibility`, `instances.visibility`, `execution_log.final_status`, `settings.value_type`) — an invalid value is rejected by Postgres itself, not just by application validation.
- **Cross-statement atomicity** goes through `withAtomic` (single-repository) or `createTransactionHelper` (cross-repository) — see §7. There is no SQLite-style `journal_mode = WAL` pragma to set; Postgres's write-ahead logging and MVCC are always on and require no per-connection configuration from this codebase.
- Application-level validation errors (e.g. `SettingsRepository` rejecting a non-numeric value for a `number`-typed setting) raise `ValidationError` / `NotFoundError` (`packages/storage/src/errors.ts`), both subclasses of `StorageError` carrying a machine-readable `code`.
