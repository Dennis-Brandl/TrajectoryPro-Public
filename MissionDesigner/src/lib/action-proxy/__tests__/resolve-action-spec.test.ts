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
import { normalizeActionLabel, resolveActionSpecForNode } from '@/lib/action-proxy/resolve-action-spec'
import type { Library, Specification } from '@/types/library'
import type { StepNodeData } from '@/types/nodes'

const lib = (id: string, name: string, entityType: Library['entityType']): Library =>
  ({ id, name, entityType, parentLibraryId: null, createdAt: 0, updatedAt: 0 }) as unknown as Library

const spec = (id: string, libraryId: string, name: string, data: Record<string, unknown>): Specification => ({
  id,
  libraryId,
  name,
  description: null,
  version: '1.0.0',
  state: 'Draft',
  data,
  history: [],
  createdAt: 0,
  updatedAt: 0,
})

const actionLib = lib('al-1', 'Kitchen Actions', 'action')
const otherActionLib = lib('al-2', 'Bakery Actions', 'action')
const preheat = spec('act-1', 'al-1', 'PreheatOven', { inputs: [{ id: 'p1', name: 'target_temp_c' }], outputs: [] })
const preheatOther = spec('act-2', 'al-2', 'PreheatOven', { inputs: [], outputs: [] })
const envA = spec('env-1', 'el-1', 'Kitchen', {
  included_actions: [{ action_name: 'PreheatOven', action_library: 'Kitchen Actions' }],
})
const envB = spec('env-2', 'el-1', 'Bakery', {
  included_actions: [{ action_name: 'PreheatOven', action_library: 'Bakery Actions' }],
})
const specById = new Map([preheat, preheatOther, envA, envB].map((s) => [s.id, s]))
const specsByLibrary = new Map<string, Specification[]>([
  ['al-1', [preheat]],
  ['al-2', [preheatOther]],
  ['el-1', [envA, envB]],
])
const libraries = [actionLib, otherActionLib]
const node = (over: Partial<StepNodeData>): StepNodeData => ({
  label: 'Run PreheatOven',
  stepType: 'actionProxyWait',
  ...over,
})

describe('normalizeActionLabel', () => {
  it('strips a leading "Run", collapses whitespace, lowercases', () => {
    expect(normalizeActionLabel('Run Bake Item')).toBe('bakeitem')
    expect(normalizeActionLabel('bakeitem')).toBe('bakeitem')
  })
})

describe('resolveActionSpecForNode', () => {
  it('resolves by normalized label through the first attached env that rosters the action', () => {
    const hit = resolveActionSpecForNode(
      { environmentSpecIds: ['env-1', 'env-2'] },
      node({}),
      specById,
      libraries,
      specsByLibrary,
    )
    expect(hit?.actionSpec.id).toBe('act-1')
    expect(hit?.envSpec.id).toBe('env-1')
    expect(hit?.libraryName).toBe('Kitchen Actions')
  })

  it("prefers the node's own environmentSpecId, then the stored config's environment_oid", () => {
    const own = resolveActionSpecForNode(
      { environmentSpecIds: ['env-1', 'env-2'] },
      node({ environmentSpecId: 'env-2' }),
      specById,
      libraries,
      specsByLibrary,
    )
    expect(own?.envSpec.id).toBe('env-2')
    expect(own?.actionSpec.id).toBe('act-2')
    const stored = resolveActionSpecForNode(
      { environmentSpecIds: ['env-1', 'env-2'] },
      node({ actionProxyConfig: { action_oid: 'x', environment_oid: 'env-2' } }),
      specById,
      libraries,
      specsByLibrary,
    )
    expect(stored?.envSpec.id).toBe('env-2')
  })

  it('restricts to actionLibraryName when the node names its library', () => {
    const hit = resolveActionSpecForNode(
      { environmentSpecIds: ['env-1', 'env-2'] },
      node({ actionLibraryName: 'Bakery Actions' }),
      specById,
      libraries,
      specsByLibrary,
    )
    expect(hit?.actionSpec.id).toBe('act-2')
  })

  it('uses actionName over the label when present', () => {
    const hit = resolveActionSpecForNode(
      { environmentSpecIds: ['env-1'] },
      node({ label: 'Something else', actionName: 'PreheatOven' }),
      specById,
      libraries,
      specsByLibrary,
    )
    expect(hit?.actionSpec.id).toBe('act-1')
  })

  it('returns undefined with no attached environments, an unknown env, an unrostered name, or a missing library', () => {
    expect(resolveActionSpecForNode({}, node({}), specById, libraries, specsByLibrary)).toBeUndefined()
    expect(
      resolveActionSpecForNode({ environmentSpecIds: ['env-missing'] }, node({}), specById, libraries, specsByLibrary),
    ).toBeUndefined()
    expect(
      resolveActionSpecForNode(
        { environmentSpecIds: ['env-1'] },
        node({ label: 'Run Nothing' }),
        specById,
        libraries,
        specsByLibrary,
      ),
    ).toBeUndefined()
    expect(
      resolveActionSpecForNode({ environmentSpecIds: ['env-1'] }, node({}), specById, [], specsByLibrary),
    ).toBeUndefined()
  })
})
