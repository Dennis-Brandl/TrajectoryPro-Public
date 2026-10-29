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

import type { Migration } from './runner.js'

export const migration: Migration = {
  name: '001-initial-schema',

  async up(q) {
    await q.query(`
      CREATE TABLE environments (
        oid text PRIMARY KEY,
        local_id text NOT NULL,
        version text NOT NULL,
        last_modified_date text NOT NULL,
        description text,
        schema_version text NOT NULL,
        action_property_specifications text NOT NULL DEFAULT '[]',
        value_property_specifications text NOT NULL DEFAULT '[]',
        resource_property_specifications text NOT NULL DEFAULT '[]',
        imported_at text NOT NULL,
        source_filename text NOT NULL,
        state text NOT NULL DEFAULT 'Draft'
          CHECK (state IN ('Draft','InTest','InReview','Approved','Effective','Superseded','Obsolete'))
      )
    `)

    await q.query(`
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
        timeout_seconds integer DEFAULT NULL,
        state text NOT NULL DEFAULT 'Draft'
          CHECK (state IN ('Draft','InTest','InReview','Approved','Effective','Superseded','Obsolete'))
      )
    `)
    await q.query(`CREATE INDEX idx_actions_environment ON actions(environment_oid)`)

    await q.query(`
      CREATE TABLE code_versions (
        id text PRIMARY KEY,
        action_oid text NOT NULL REFERENCES actions(oid) ON DELETE CASCADE,
        state text NOT NULL,
        version_number integer NOT NULL,
        source_code text NOT NULL,
        is_active boolean NOT NULL DEFAULT false,
        created_at text NOT NULL,
        created_by text,
        description text,
        UNIQUE (action_oid, state, version_number)
      )
    `)
    await q.query(`CREATE INDEX idx_code_versions_action_state ON code_versions(action_oid, state)`)
    await q.query(`
      CREATE INDEX idx_code_versions_active ON code_versions(action_oid, state, is_active)
        WHERE is_active
    `)

    await q.query(`
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
        traceback text,
        is_logged boolean NOT NULL DEFAULT false
      )
    `)
    await q.query(`CREATE INDEX idx_instances_state ON instances(state)`)
    await q.query(`CREATE INDEX idx_instances_action ON instances(action_oid)`)
    await q.query(`CREATE INDEX idx_instances_workflow ON instances(workflow_instance_id)`)
    await q.query(`
      CREATE INDEX idx_instances_cleanup ON instances(completed_at, is_logged)
        WHERE completed_at IS NOT NULL
    `)

    await q.query(`
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
      )
    `)
    await q.query(`CREATE INDEX idx_log_action ON execution_log(action_name)`)
    await q.query(`CREATE INDEX idx_log_environment ON execution_log(environment_oid)`)
    await q.query(`CREATE INDEX idx_log_status ON execution_log(final_status)`)
    await q.query(`CREATE INDEX idx_log_completed ON execution_log(completed_at)`)
    // idx_log_oldest (id ASC) from the SQLite schema is NOT recreated: the
    // primary-key btree already serves oldest-first scans.

    await q.query(`
      CREATE TABLE settings (
        key text PRIMARY KEY,
        value text NOT NULL,
        default_value text NOT NULL,
        description text NOT NULL,
        value_type text NOT NULL CHECK (value_type IN ('number', 'string', 'boolean'))
      )
    `)
    await q.query(
      `INSERT INTO settings (key, value, default_value, description, value_type) VALUES
        ('log_max_size', '10000', '10000', 'Maximum execution log entries before rollover', 'number'),
        ('python_pool_size', '4', '4', 'Number of Python subprocess workers', 'number'),
        ('execution_timeout_ms', '60000', '60000', 'Default timeout for Python code execution per state (ms)', 'number'),
        ('instance_retention_hours', '24', '24', 'Hours to retain completed instance records before cleanup', 'number'),
        ('api_key', '', '', 'API key required on protected routes (X-API-Key header). Empty = open access.', 'string')
       ON CONFLICT (key) DO NOTHING`
    )
  },
}
