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

// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useActionProxySyncState } from '@/hooks/useActionProxySyncState'
import { useLibraryStore } from '@/stores/libraryStore'
import type { Library, Specification } from '@/types/library'
import type { StepNodeData } from '@/types/nodes'

const wfLib = { id: 'wf-lib-1', parentLibraryId: null, name: 'Workflows', entityType: 'workflow' } as unknown as Library
const actionLib = {
  id: 'action-lib-1',
  parentLibraryId: null,
  name: 'Kitchen Actions',
  entityType: 'action',
} as unknown as Library
const envLib = {
  id: 'env-lib-1',
  parentLibraryId: null,
  name: 'Environments',
  entityType: 'environment',
} as unknown as Library
const spec = (id: string, libraryId: string, name: string, data: Record<string, unknown>): Specification =>
  ({
    id,
    libraryId,
    name,
    version: '1.0.0',
    state: 'Draft',
    data,
    history: [],
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as Specification
const actionSpec = spec('act-1', 'action-lib-1', 'PreheatOven', {
  inputs: [{ id: 'p1', name: 'target_temp_c', description: '' }],
  outputs: [{ id: 'o1', name: 'reached', description: '' }],
})
const envSpec = spec('env-1', 'env-lib-1', 'Kitchen', {
  included_actions: [{ action_name: 'PreheatOven', action_library: 'Kitchen Actions' }],
})
const workflowSpec = spec('wf-1', 'wf-lib-1', 'WF', { environmentSpecIds: ['env-1'] })

function seed(actionSpecs: Specification[] | null = [actionSpec]) {
  useLibraryStore.setState({
    libraries: [wfLib, actionLib, envLib],
    selectedLibraryId: 'wf-lib-1',
    selectedSpecificationId: 'wf-1',
    specifications: new Map([
      ['wf-lib-1', [workflowSpec]],
      ...(actionSpecs ? [['action-lib-1', actionSpecs] as [string, Specification[]]] : []),
      ['env-lib-1', [envSpec]],
    ]),
  })
}

const synced: StepNodeData = {
  label: 'Run PreheatOven',
  stepType: 'actionProxyWait',
  actionName: 'PreheatOven',
  actionLibraryName: 'Kitchen Actions',
  inputs: [{ id: 'p1', name: 'target_temp_c', description: '', value: '180', valueType: 'literal' }],
  outputs: [{ id: 'o1', name: 'reached', description: '', target: 'Oven.Reached' }],
}

beforeEach(() =>
  useLibraryStore.setState({
    libraries: [],
    specifications: new Map(),
    selectedSpecificationId: null,
    selectedLibraryId: null,
  }),
)

describe('useActionProxySyncState (spec 2026-09-04 §6.3)', () => {
  it("'n/a' when the node names no action", () => {
    seed()
    expect(
      renderHook(() => useActionProxySyncState({ label: '', stepType: 'actionProxyWait' })).result.current.status,
    ).toBe('n/a')
  })

  it('resolves an imported node by label when actionName is absent', () => {
    // The package importer never writes actionName/actionLibraryName/environmentSpecId on
    // ACTION PROXY nodes — only `label` (the step's local id). Spec 2026-09-04 final review #1.
    seed()
    const imported: StepNodeData = {
      label: 'PreheatOven',
      stepType: 'actionProxyWait',
      inputs: [{ id: 'p1', name: 'target_temp_c', description: '', value: '180', valueType: 'literal' }],
      outputs: [],
    }
    const r = renderHook(() => useActionProxySyncState(imported)).result.current
    expect(r.status).toBe('outdated')
  })

  it('returns n/a when the node has neither actionName nor label', () => {
    seed()
    const bare = { label: '', stepType: 'actionProxyWait' } as StepNodeData
    expect(renderHook(() => useActionProxySyncState(bare)).result.current.status).toBe('n/a')
  })

  it('returns n/a without resolving when disabled', () => {
    seed()
    const stale: StepNodeData = { ...synced, outputs: [] }
    const r = renderHook(() => useActionProxySyncState(stale, false)).result.current
    expect(r.status).toBe('n/a')
  })

  it("'unresolved' when the action library's specs are not loaded", () => {
    seed(null)
    expect(renderHook(() => useActionProxySyncState(synced)).result.current.status).toBe('unresolved')
  })

  it("'synced' when the node matches the action", () => {
    seed()
    const r = renderHook(() => useActionProxySyncState(synced)).result.current
    expect(r.status).toBe('synced')
    expect(r.diff).toBeNull()
    expect(r.actionSpec?.id).toBe('act-1')
  })

  it("'outdated' with a diff and a merged signature that keeps the node's value and target", () => {
    seed()
    const stale: StepNodeData = { ...synced, outputs: [] }
    const r = renderHook(() => useActionProxySyncState(stale)).result.current
    expect(r.status).toBe('outdated')
    expect(r.diff).toEqual({
      inputs: { added: [], removed: [], changed: [] },
      outputs: { added: ['reached'], removed: [], changed: [] },
    })
    expect(r.merged).toEqual({
      inputs: [{ id: 'p1', name: 'target_temp_c', description: '', value: '180', valueType: 'literal' }],
      outputs: [{ id: 'o1', name: 'reached', description: '' }],
    })
  })
})
