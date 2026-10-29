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

// Final-review follow-up (2026-08-21 action-proxy name binding): the gear picker's
// selection payload now carries the resolved oid binding (actionOid + environmentSpecId).
// This exercises the REAL component wiring — store-seeded candidates, the first-env-wins
// dedupe attribution, and the payload handed to onActionSelect — not the pure mapper
// (action-selection.test.ts covers that).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionSelector } from '../ActionSelector'
import { useLibraryStore } from '@/stores/libraryStore'
import type { Library, Specification } from '@/types/library'

const wfLib = {
  id: 'wf-lib-1',
  parentLibraryId: null,
  name: 'Workflows',
  entityType: 'workflow',
} as unknown as Library
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

const actionSpec = {
  id: 'act-1',
  libraryId: 'action-lib-1',
  name: 'PreheatOven',
  version: '1.0.0',
  state: 'Draft',
  data: { inputs: [{ id: 'p1', name: 'target_temp_c', description: '' }], outputs: [] },
  history: [],
  createdAt: 0,
  updatedAt: 0,
} as unknown as Specification

const envSpec = (id: string, name: string): Specification =>
  ({
    id,
    libraryId: 'env-lib-1',
    name,
    version: '1.0.0',
    state: 'Draft',
    data: { included_actions: [{ action_name: 'PreheatOven', action_library: 'Kitchen Actions' }] },
    history: [],
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as Specification

// Both attached envs roster the same action — the dedupe keeps the FIRST env's candidate,
// so the payload must attribute the selection to env-1.
const workflowSpec = {
  id: 'wf-1',
  libraryId: 'wf-lib-1',
  name: 'WF',
  version: '1.0.0',
  state: 'Draft',
  data: { environmentSpecIds: ['env-1', 'env-2'] },
  history: [],
  createdAt: 0,
  updatedAt: 0,
} as unknown as Specification

beforeEach(() => {
  useLibraryStore.setState({
    libraries: [wfLib, actionLib, envLib],
    selectedLibraryId: 'wf-lib-1',
    selectedSpecificationId: 'wf-1',
    specifications: new Map([
      ['wf-lib-1', [workflowSpec]],
      ['action-lib-1', [actionSpec]],
      ['env-lib-1', [envSpec('env-1', 'Kitchen'), envSpec('env-2', 'Bakery')]],
    ]),
    fetchSpecifications: vi.fn(async () => {}),
  })
})

function openSelect(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0 })
  fireEvent.click(trigger)
}

describe('ActionSelector selection payload', () => {
  it('hands onActionSelect the resolved oid binding, attributed to the first env offering the action', async () => {
    const onActionSelect = vi.fn()
    render(<ActionSelector onActionSelect={onActionSelect} />)

    openSelect(screen.getByRole('combobox'))
    const option = await screen.findByRole('option', { name: /PreheatOven/ })
    fireEvent.click(option)

    expect(onActionSelect).toHaveBeenCalledTimes(1)
    expect(onActionSelect).toHaveBeenCalledWith({
      name: 'PreheatOven',
      libraryName: 'Kitchen Actions',
      actionOid: 'act-1',
      environmentSpecId: 'env-1',
      inputs: [{ id: 'p1', name: 'target_temp_c', description: '' }],
      outputs: [],
    })
  })

  it('offers the action only once despite two envs rostering it', async () => {
    render(<ActionSelector onActionSelect={vi.fn()} />)
    openSelect(screen.getByRole('combobox'))
    expect(await screen.findAllByRole('option')).toHaveLength(1)
  })
})
