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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ActionDetailView } from '@/components/detail/ActionDetailView'
import { EnvironmentDetailView } from '@/components/detail/EnvironmentDetailView'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import { useLibraryStore } from '@/stores/libraryStore'

vi.mock('@/hooks/useCanEditActiveSpec', () => ({ useCanEditActiveSpec: vi.fn() }))

// Mock heavy sub-components — the fieldset lives in the detail views themselves,
// not in these children, so mocking them keeps rendering fast and stable.
vi.mock('@/components/properties/ValuesEditor', () => ({ ValuesEditor: () => <div /> }))
vi.mock('@/components/detail/environment/IncludedActionsSection', () => ({
  IncludedActionsSection: () => <div />,
}))
vi.mock('@/components/detail/environment/PropertyValuesSection', () => ({
  PropertyValuesSection: () => <div />,
}))
vi.mock('@/components/detail/environment/ResourcesSection', () => ({ ResourcesSection: () => <div /> }))
vi.mock('@/components/detail/environment/ActionServersSection', () => ({
  ActionServersSection: () => <div />,
}))
vi.mock('@/components/version', () => ({
  VersionBadge: () => <div />,
  VersionHistoryDialog: () => <div />,
}))
vi.mock('@/components/toolbar/SaveStatusButton', () => ({ SaveStatusButton: () => <button /> }))

// useSpecificationById reads from libraryStore.specifications (Map<libId, Specification[]>)
// via useSpecIndex. Seeding libraryStore is the correct approach.
function seedSelectedSpec(entityType: 'action' | 'environment') {
  const spec = {
    id: 's1',
    parentSpecificationId: null,
    rootSpecificationId: 's1',
    libraryId: 'lib1',
    name: 'S',
    description: null,
    version: '1.0.0',
    state: 'Draft',
    data: {},
    dataSchemaVersion: 1,
    history: [],
    createdAt: 0,
    updatedAt: 0,
    lastEditedByUserId: null,
  } as never

  useLibraryStore.setState({
    specifications: new Map([['lib1', [spec]]]),
    selectedLibraryId: 'lib1',
    selectedSpecificationId: 's1',
    libraries: [
      {
        id: 'lib1',
        name: 'Lib',
        entityType,
        teamId: 'team-a',
        parentLibraryId: null,
        userId: 'u1',
        description: null,
        author: null,
        changeHistory: null,
        version: '1.0.0',
        forkedFromLibraryId: null,
        forkedFromVersion: null,
        forkedAt: null,
        environmentLibraryIds: [],
        createdAt: 0,
        updatedAt: 0,
        lastEditedByUserId: null,
      } as never,
    ],
  })
}

beforeEach(() => vi.clearAllMocks())

describe('detail views read-only', () => {
  it('ActionDetailView wraps fields in a disabled fieldset when read-only', () => {
    vi.mocked(useCanEditActiveSpec).mockReturnValue(false)
    seedSelectedSpec('action')
    const { container } = render(<ActionDetailView />)
    expect((container.querySelector('fieldset') as HTMLFieldSetElement)?.disabled).toBe(true)
  })

  it('EnvironmentDetailView wraps fields in a disabled fieldset when read-only', () => {
    vi.mocked(useCanEditActiveSpec).mockReturnValue(false)
    seedSelectedSpec('environment')
    const { container } = render(<EnvironmentDetailView />)
    expect((container.querySelector('fieldset') as HTMLFieldSetElement)?.disabled).toBe(true)
  })
})
