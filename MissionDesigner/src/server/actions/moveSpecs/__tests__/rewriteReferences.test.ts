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
import { rewriteActionRefsInData } from '../rewriteReferences'

const names = new Set(['Heat'])

describe('rewriteActionRefsInData', () => {
  it('rewrites matching included_actions, legacy includedActions and ACTION PROXY nodes', () => {
    const data = JSON.stringify({
      included_actions: [
        { action_library: 'Lib A', action_name: 'Heat' },
        { action_library: 'Lib A', action_name: 'Cool' },
        { action_library: 'Other', action_name: 'Heat' },
      ],
      includedActions: [{ actionLibrary: 'Lib A', actionName: 'Heat' }],
      nodes: [
        { id: 'n1', data: { actionName: 'Heat', actionLibraryName: 'Lib A' } },
        { id: 'n2', data: { actionName: 'Heat', actionLibraryName: 'Other' } },
        { id: 'n3', data: { actionName: 'Cool', actionLibraryName: 'Lib A' } },
      ],
    })
    const r = rewriteActionRefsInData(data, names, 'Lib A', 'Lib B')
    expect(r.changed).toBe(true)
    const out = JSON.parse(r.json)
    expect(out.included_actions.map((a: { action_library: string }) => a.action_library)).toEqual([
      'Lib B',
      'Lib A',
      'Other',
    ])
    expect(out.includedActions[0].actionLibrary).toBe('Lib B')
    expect(out.nodes.map((n: { data: { actionLibraryName: string } }) => n.data.actionLibraryName)).toEqual([
      'Lib B',
      'Other',
      'Lib A',
    ])
  })

  it('returns identical text and changed:false when nothing matches', () => {
    const data = '{ "nodes": [ { "data": { "actionName": "Cool", "actionLibraryName": "Lib A" } } ] }'
    expect(rewriteActionRefsInData(data, names, 'Lib A', 'Lib B')).toEqual({ json: data, changed: false })
  })

  it('tolerates missing nodes and malformed JSON', () => {
    expect(rewriteActionRefsInData('{}', names, 'Lib A', 'Lib B')).toEqual({ json: '{}', changed: false })
    expect(rewriteActionRefsInData('not json', names, 'Lib A', 'Lib B')).toEqual({
      json: 'not json',
      changed: false,
    })
    expect(
      rewriteActionRefsInData('{"nodes":[null,{"data":null}],"included_actions":[null]}', names, 'a', 'b').changed,
    ).toBe(false)
  })
})
