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

import { describe, it, expect } from 'vitest'
import { assertSmokeDatabaseUrl } from '../testing.js'

// Guards the real-PG smoke suite's DROP SCHEMA against ever pointing at a real
// database: the target's database NAME must be suffixed `_smoke`.
describe('assertSmokeDatabaseUrl', () => {
  it('accepts a database name suffixed _smoke', () => {
    expect(() =>
      assertSmokeDatabaseUrl('postgres://u:p@127.0.0.1:5434/trajectory_smoke')
    ).not.toThrow()
    expect(() => assertSmokeDatabaseUrl('postgresql://u@localhost/anything_smoke')).not.toThrow()
  })

  it('rejects the production database and any name without the suffix', () => {
    expect(() => assertSmokeDatabaseUrl('postgres://u:p@127.0.0.1:5434/mission_autopilot')).toThrow(
      /_smoke/
    )
    expect(() => assertSmokeDatabaseUrl('postgres://u:p@127.0.0.1:5434/smoke')).toThrow(/_smoke/)
    expect(() => assertSmokeDatabaseUrl('postgres://u:p@127.0.0.1:5434/smoke_db')).toThrow(/_smoke/)
  })

  it('rejects URLs with no database name', () => {
    expect(() => assertSmokeDatabaseUrl('postgres://u:p@127.0.0.1:5434')).toThrow(/_smoke/)
    expect(() => assertSmokeDatabaseUrl('postgres://u:p@127.0.0.1:5434/')).toThrow(/_smoke/)
  })

  it('rejects unparseable URLs', () => {
    expect(() => assertSmokeDatabaseUrl('not a url')).toThrow()
  })
})
