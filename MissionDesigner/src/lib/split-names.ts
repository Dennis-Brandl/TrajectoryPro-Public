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
 * The first-run screens take one name or a comma-separated list ("Engineering, Quality").
 * Splits on commas, trims each piece, drops the empty ones, and keeps only the first of
 * any names that match ignoring case, in the order typed.
 */
export function splitNames(raw: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const piece of raw.split(',')) {
    const name = piece.trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}
