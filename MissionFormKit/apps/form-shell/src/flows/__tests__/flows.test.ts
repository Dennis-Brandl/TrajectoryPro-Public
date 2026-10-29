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
import { MockEngine } from '../../engine/MockEngine'
import { FLOWS } from '../index'
import { inspectionFlow } from '../inspection'

const press = (outputValue: string) => ({ blockId: 'b', outputValue })

describe('flow registry', () => {
  it('every registered flow builds a valid MockEngine and starts on a screen', () => {
    for (const flow of FLOWS) {
      const t = flow.createEngine().start()
      expect(t.kind).toBe('screen')
    }
  })
})

describe('inspection flow', () => {
  // The engine is positional, so these walk the flow from the entry rather than
  // poking a node directly — which also proves each branch is actually reachable.
  const engine = () => {
    const e = new MockEngine(inspectionFlow)
    e.start()
    return e
  }

  it('starts on the identify screen', () => {
    const t = new MockEngine(inspectionFlow).start()
    expect(t).toMatchObject({ kind: 'screen', screenId: 's1-identify' })
  })

  it('routes s2 pass and fail to different screens', () => {
    const pass = engine()
    pass.next({}, press('continue')) // s1 -> s2
    expect(pass.next({}, press('pass'))).toMatchObject({ screenId: 's3-pass' })

    const fail = engine()
    fail.next({}, press('continue'))
    expect(fail.next({}, press('fail'))).toMatchObject({ screenId: 's3-fail' })
  })

  it('both terminal screens complete on finish', () => {
    const pass = engine()
    pass.next({}, press('continue'))
    pass.next({}, press('pass'))
    expect(pass.next({}, press('finish'))).toEqual({ kind: 'complete' })

    const fail = engine()
    fail.next({}, press('continue'))
    fail.next({}, press('fail'))
    expect(fail.next({}, press('finish'))).toEqual({ kind: 'complete' })
  })
})
