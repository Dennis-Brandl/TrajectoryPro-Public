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
import { actionSelectionToDraft, type SelectedAction } from '../action-selection'

const selection: SelectedAction = {
  name: 'PreheatOven',
  libraryName: 'First Action Library',
  actionOid: 'act-fresh-001',
  environmentSpecId: 'env-spec-001',
  inputs: [],
  outputs: [],
}

describe('actionSelectionToDraft', () => {
  it('writes the full oid binding alongside the design-time name fields', () => {
    const draft = actionSelectionToDraft(selection, {})
    expect(draft).toEqual({
      label: 'PreheatOven',
      actionName: 'PreheatOven',
      actionLibraryName: 'First Action Library',
      environmentSpecId: 'env-spec-001',
      inputs: [],
      outputs: [],
      actionProxyConfig: {
        action_oid: 'act-fresh-001',
        environment_oid: 'env-spec-001',
      },
    })
  })

  it('preserves an existing timeout_ms', () => {
    const draft = actionSelectionToDraft(selection, {
      actionProxyConfig: { action_oid: 'act-old', environment_oid: 'env-old', timeout_ms: 45000 },
    })
    expect(draft.actionProxyConfig?.timeout_ms).toBe(45000)
    expect(draft.actionProxyConfig?.action_oid).toBe('act-fresh-001')
  })

  it('leaves timeout_ms unset for any action when none was authored', () => {
    const draft = actionSelectionToDraft(selection, {})
    expect(draft.actionProxyConfig?.action_oid).toBe('act-fresh-001')
    expect(draft.actionProxyConfig && 'timeout_ms' in draft.actionProxyConfig).toBe(false)
  })

  it('keeps an authored timeout_ms on Wait for Runtime Workflow', () => {
    const draft = actionSelectionToDraft(
      { ...selection, name: 'Wait for Runtime Workflow' },
      { actionProxyConfig: { action_oid: 'act-old', environment_oid: 'env-old', timeout_ms: 600000 } },
    )
    expect(draft.actionProxyConfig?.timeout_ms).toBe(600000)
  })
})
