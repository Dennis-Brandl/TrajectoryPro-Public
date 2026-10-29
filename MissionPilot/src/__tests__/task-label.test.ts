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
import { taskLabel } from '../task-label'

describe('taskLabel', () => {
  it('is "<step> · <runtime ID>"', () => {
    expect(taskLabel({ stepName: 'Charge Kettle', stepOid: 'rt_12', runtimeLabel: 'MIX-20261009-0002' })).toBe(
      'Charge Kettle · MIX-20261009-0002',
    )
  })

  it('falls back to the step oid when the step has no name (never prints "null")', () => {
    expect(taskLabel({ stepName: null, stepOid: 'rt_12', runtimeLabel: 'RW-7' })).toBe('rt_12 · RW-7')
  })
})
