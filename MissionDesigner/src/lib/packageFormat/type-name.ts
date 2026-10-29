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

/** Maximum length of an ISA 88 type name (after trimming). */
export const TYPE_NAME_MAX = 50

/**
 * Reads the optional `type_name` key of an imported workflow spec.
 * Non-string, blank, or over-long values yield null (old packages stay valid;
 * the type is informational only and never blocks an import).
 */
export function readTypeName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > TYPE_NAME_MAX) return null
  return trimmed
}
