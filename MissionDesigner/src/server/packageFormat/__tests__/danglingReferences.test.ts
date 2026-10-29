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
import { findDanglingReferences } from '@/server/packageFormat/danglingReferences'

describe('findDanglingReferences', () => {
  it('finds workflow specs referencing replaced environment-spec OIDs', () => {
    const refs = findDanglingReferences({
      replacedSpecOids: new Set(['ENV-OLD']),
      replacedActionLibNames: new Set(),
      excludedReferrerOids: new Set(),
      specifications: [
        {
          id: 'WF1',
          libraryId: 'L1',
          name: 'Workflow 1',
          entityType: 'workflow',
          data: { environmentSpecIds: ['ENV-OLD'] },
        },
      ],
    })
    expect(refs).toEqual([
      { referrerOid: 'WF1', referrerName: 'Workflow 1', referrerEntityType: 'workflow', brokenReferenceTo: 'ENV-OLD' },
    ])
  })

  it('finds step specs whose proxy nodes reference replaced workflow OIDs', () => {
    const refs = findDanglingReferences({
      replacedSpecOids: new Set(['WF-OLD']),
      replacedActionLibNames: new Set(),
      excludedReferrerOids: new Set(),
      specifications: [
        {
          id: 'ST1',
          libraryId: 'L2',
          name: 'Step 1',
          entityType: 'step',
          data: { nodes: [{ id: 'n1', type: 'workflowProxy', data: { referencedSpecId: 'WF-OLD' } }] },
        },
      ],
    })
    expect(refs[0].brokenReferenceTo).toBe('WF-OLD')
  })

  it('finds env specs referencing replaced action library names', () => {
    const refs = findDanglingReferences({
      replacedSpecOids: new Set(),
      replacedActionLibNames: new Set(['OldActions']),
      excludedReferrerOids: new Set(),
      specifications: [
        {
          id: 'EN1',
          libraryId: 'L3',
          name: 'Env 1',
          entityType: 'environment',
          data: { included_actions: [{ action_library: 'OldActions' }] },
        },
      ],
    })
    expect(refs[0].brokenReferenceTo).toBe('OldActions')
  })

  it('skips referrers in the excluded set', () => {
    const refs = findDanglingReferences({
      replacedSpecOids: new Set(['ENV-OLD']),
      replacedActionLibNames: new Set(),
      excludedReferrerOids: new Set(['WF1']),
      specifications: [
        {
          id: 'WF1',
          libraryId: 'L1',
          name: 'Workflow 1',
          entityType: 'workflow',
          data: { environmentSpecIds: ['ENV-OLD'] },
        },
      ],
    })
    expect(refs).toEqual([])
  })
})
