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

/** Minimal values for the Task-1 NOT NULL control-recipe columns, for tests whose subject
 *  is NOT runtime workflows. Monotonic runtimeNumber keeps (wc, number) unique per file. */
let n = 0;
export function runtimeCols(overrides: Record<string, unknown> = {}) {
  n += 1;
  // Merge first, so an override of runtimeNumber alone is still reflected in merged.runtimeNumber
  // below — then derive runtimeLabel from THAT, not from the pre-override `n`. Spreading
  // ...overrides after the literal fields (as this function always has) means an override's
  // own runtimeLabel, if given, already wins in `merged`; the `??` below only fills in when
  // the caller didn't supply one.
  const merged = {
    specJsonb: { oid: `helper-spec-${n}`, steps: [], connections: [] },
    runtimeNumber: n,
    masterName: 'HelperWF', masterOid: `helper-oid-${n}`, masterVersion: '1.0.0', masterState: 'Draft',
    ...overrides,
  };
  return {
    ...merged,
    runtimeLabel: (overrides.runtimeLabel as string | undefined) ?? `RW-${merged.runtimeNumber}`,
  };
}
