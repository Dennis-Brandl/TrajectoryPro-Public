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
 * Error constant returned when a pre-v4.0 file is detected.
 * Callers should show a blocking dialog when they see this error.
 */
export const LEGACY_FORMAT_ERROR = 'LEGACY_FORMAT'

/**
 * Detects whether a parsed JSON object represents a pre-v4.0 Trajectory export.
 * Rejects anything with schemaVersion < 4.0 or no schemaVersion at all.
 * Uses parseFloat for robust version comparison.
 */
export function isLegacySchemaVersion(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>

  // Check single spec
  if (obj.schemaVersion && parseFloat(obj.schemaVersion as string) < 4.0) return true

  // Check library with specs
  const specs = obj.workflow_specifications as Array<Record<string, unknown>> | undefined
  if (specs?.some((s) => s.schemaVersion && parseFloat(s.schemaVersion as string) < 4.0)) return true

  // No schemaVersion at all = pre-v4.0
  if (obj.steps && !obj.schemaVersion) return true
  if (specs?.some((s) => s.steps && !s.schemaVersion)) return true

  return false
}
