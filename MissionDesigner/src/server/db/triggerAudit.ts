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

// Phase 35 cutover (§5.6.1 F8): trigger coverage audit table.
// Created only in dev/test environments. Each trigger from §1 has a side-effect
// INSERT into this table; the seed script asserts every defined trigger fired
// at least once.
//
// In production, this table does not exist. The Postgres triggers guard
// the audit INSERT with `to_regclass('_trigger_audit') IS NOT NULL`, so the
// insert is silently skipped when the table is absent.

export function isTriggerAuditEnabled(): boolean {
  return process.env.NODE_ENV !== 'production'
}

export const TRIGGER_AUDIT_CREATE_SQL = `
CREATE TABLE IF NOT EXISTS "_trigger_audit" (
  "triggerName" text NOT NULL,
  "firedAt" bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS "_trigger_audit_name_idx" ON "_trigger_audit" ("triggerName");
`
