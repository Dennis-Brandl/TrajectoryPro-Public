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

import Database from 'better-sqlite3'

/** In-memory SQLite database shaped like a fully-migrated v2 container store. */
export function buildFixtureSqlite(): InstanceType<typeof Database> {
  const s = new Database(':memory:')
  s.exec(
    `CREATE TABLE _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)`
  )
  for (const n of [
    '001-initial-schema',
    '002-action-timeout',
    '003-lifecycle-state',
    '004-api-key-setting',
  ])
    s.prepare(
      `INSERT INTO _migrations (name, applied_at) VALUES (?, '2026-01-01T00:00:00.000Z')`
    ).run(n)
  s.exec(`CREATE TABLE environments (oid TEXT PRIMARY KEY, local_id TEXT, version TEXT,
    last_modified_date TEXT, description TEXT, schema_version TEXT,
    action_property_specifications TEXT, value_property_specifications TEXT,
    resource_property_specifications TEXT, imported_at TEXT, source_filename TEXT, state TEXT)`)
  s.exec(`CREATE TABLE actions (oid TEXT PRIMARY KEY, environment_oid TEXT, local_id TEXT, version TEXT,
    last_modified_date TEXT, description TEXT, action_visibility TEXT,
    input_parameter_specifications TEXT, output_parameter_specifications TEXT,
    property_specifications TEXT, timeout_seconds INTEGER, state TEXT)`)
  s.exec(`CREATE TABLE code_versions (id TEXT PRIMARY KEY, action_oid TEXT, state TEXT,
    version_number INTEGER, source_code TEXT, is_active INTEGER, created_at TEXT, created_by TEXT, description TEXT)`)
  s.exec(
    `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, default_value TEXT, description TEXT, value_type TEXT)`
  )
  s.prepare(
    `INSERT INTO environments VALUES ('e1','Env','1.0.0','2026-01-01T00:00:00.000Z',NULL,'4.0','[]','[]','[]','2026-01-02T00:00:00.000Z','f.WFenvir','Effective')`
  ).run()
  s.prepare(
    `INSERT INTO actions VALUES ('a1','e1','Act','1.0.0','2026-01-01T00:00:00.000Z',NULL,'observable','[]','[]','[]',30,'Draft')`
  ).run()
  s.prepare(
    `INSERT INTO code_versions VALUES ('c1','a1','EXECUTING',1,'print(1)',1,'2026-01-03T00:00:00.000Z',NULL,NULL)`
  ).run()
  s.prepare(`INSERT INTO settings VALUES ('python_pool_size','8','4','x','number')`).run()
  s.prepare(`INSERT INTO settings VALUES ('obsolete_key','1','1','x','number')`).run()
  return s
}
