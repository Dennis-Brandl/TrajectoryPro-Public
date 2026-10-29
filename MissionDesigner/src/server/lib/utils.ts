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
 * Safely parse a JSON string, returning a fallback value on failure.
 * Use this instead of bare JSON.parse() on database-stored JSON fields
 * to prevent unhandled exceptions from corrupted data.
 */
export function safeParse<T = unknown>(json: string, fallback: T = null as T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    console.error('Failed to parse JSON:', json?.slice(0, 100))
    return fallback
  }
}
