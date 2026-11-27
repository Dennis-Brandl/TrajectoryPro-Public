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
import {
  collectSyncPartnerWarnings,
  collectSyncPartnerWarningsWithChildren,
  formatSyncPartnerWarnings,
} from '../sync-partner-warnings'
import type { Specification } from '@/types/library'
import type { StepResourceCommand, WorkflowNode } from '@/types/nodes'

const step = (label: string, cmd: Partial<StepResourceCommand>) =>
  ({
    id: label,
    type: 'userInteractionStep',
    position: { x: 0, y: 0 },
    data: {
      label,
      resourceCommands: [
        {
          id: `c-${label}`,
          resourceName: 'Chan',
          commandType: 'Synchronize',
          count: 1,
          resourceSourceType: 'workflow',
          ...cmd,
        },
      ],
    },
  }) as unknown as WorkflowNode

const WARNING =
  'SYNC "Chan" on "Weigh" waits for more than 2 partners, but "Chan" is declared in this workflow, so other workflows cannot join it. Declare it in the environment for separate workflows to synchronize.'

describe('collectSyncPartnerWarnings', () => {
  it('warns for a workflow-scoped Synchronize with 3 partners', () => {
    expect(collectSyncPartnerWarnings([step('Weigh', { partners: '3' })])).toEqual([WARNING])
  })

  it('warns for a workflow-scoped Synchronize in Source mode', () => {
    expect(
      collectSyncPartnerWarnings([step('Weigh', { partnersValueType: 'property', partnersProperty: 'Batches' })]),
    ).toEqual([WARNING])
  })

  it('no warning at 2 partners or for an environment resource', () => {
    expect(collectSyncPartnerWarnings([step('A', {}), step('B', { partners: ' 2 ' })])).toEqual([])
    expect(collectSyncPartnerWarnings([step('C', { partners: '3', resourceSourceType: 'environment' })])).toEqual([])
  })

  it('no warning for Send or Receive', () => {
    expect(collectSyncPartnerWarnings([step('D', { commandType: 'Send', partners: '3' })])).toEqual([])
  })

  it('formats with the Sync partners prefix and the shared separator', () => {
    expect(formatSyncPartnerWarnings(['a', 'b'])).toBe('Sync partners: a · b')
  })

  it('uses the resource as export resolves it, not the source stored on the command', () => {
    const env = new Map([['Chan', { type: 'environment' as const }]])
    const wf = new Map([['Chan', { type: 'workflow' as const }]])
    expect(collectSyncPartnerWarnings([step('Weigh', { partners: '3' })], env)).toEqual([])
    expect(
      collectSyncPartnerWarnings([step('Weigh', { partners: '3', resourceSourceType: 'environment' })], wf),
    ).toEqual([WARNING])
  })
})

describe('collectSyncPartnerWarningsWithChildren', () => {
  const spec = (id: string, name: string, data: Record<string, unknown>) =>
    ({
      id,
      name,
      libraryId: 'L',
      version: '1.0.0',
      state: 'Draft',
      history: [],
      createdAt: 0,
      updatedAt: 0,
      data,
    }) as unknown as Specification
  const envSpec = spec('env-1', 'Plant', { resources: [{ id: 'r', name: 'Chan', resourceType: 'Sync' }] })

  it('warns for a child workflow whose Synchronize uses its own Sync resource, naming the child', () => {
    const child = spec('child-1', 'Dispense', {
      parentSpecificationId: 'wf-1',
      workflowResources: [{ id: 'r2', name: 'Chan', resourceType: 'Sync' }],
      nodes: [step('Weigh', { partners: '3', resourceSourceType: undefined })],
      edges: [],
    })
    const parent = spec('wf-1', 'Batch', { environmentSpecIds: [] })
    expect(collectSyncPartnerWarningsWithChildren([], 'wf-1', [parent, child, envSpec])).toEqual([
      `Dispense — ${WARNING}`,
    ])
  })

  it('no warning when the open workflow uses the environment Sync resource', () => {
    const parent = spec('wf-1', 'Batch', { environmentSpecIds: ['env-1'] })
    expect(
      collectSyncPartnerWarningsWithChildren([step('Weigh', { partners: '3' })], 'wf-1', [parent, envSpec]),
    ).toEqual([])
  })
})
