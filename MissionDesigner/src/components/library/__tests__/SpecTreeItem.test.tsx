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

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { info: vi.fn() } }))

import { act, render, renderHook, screen, fireEvent } from '@testing-library/react'
import { toast } from 'sonner'
import { SpecTreeItem } from '../SpecTreeItem'
import type { SpecTreeNode } from '../SpecTreeItem'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecExpansion } from '@/hooks/useSpecExpansion'
import { usePrincipalStore } from '@/stores/principalStore'
import type { MePrincipal } from '@/stores/specificationStore/apiClient'

const NODE_A: SpecTreeNode = {
  id: 'a',
  libraryId: 'lib',
  name: 'Workflow A',
  version: '1.0.0',
  state: 'Draft',
  description: null,
  createdAt: 0,
  updatedAt: 0,
  lastEditedByUserId: null,
  children: [],
  referencedChildren: [],
}

const NODE_A_WITH_CHILD: SpecTreeNode = {
  ...NODE_A,
  children: [{ ...NODE_A, id: 'a-1', name: 'Child A1' }],
}

beforeEach(() => {
  localStorage.clear()
})

describe('SpecTreeItem', () => {
  it('renders the spec name', () => {
    render(<SpecTreeItem node={NODE_A} libraryId="lib" depth={0} searchQuery="" />)
    expect(screen.getByText('Workflow A')).toBeTruthy()
  })

  it('renders no chevron when there are no children', () => {
    render(<SpecTreeItem node={NODE_A} libraryId="lib" depth={0} searchQuery="" />)
    expect(screen.queryByRole('button', { name: /expand|collapse/i })).toBeNull()
  })

  it('renders a chevron and hides children until expanded', () => {
    render(<SpecTreeItem node={NODE_A_WITH_CHILD} libraryId="lib" depth={0} searchQuery="" />)
    expect(screen.getByRole('button', { name: /expand/i })).toBeTruthy()
    expect(screen.queryByText('Child A1')).toBeNull()
  })

  it('expands on chevron click and shows children', () => {
    render(<SpecTreeItem node={NODE_A_WITH_CHILD} libraryId="lib" depth={0} searchQuery="" />)
    fireEvent.click(screen.getByRole('button', { name: /expand/i }))
    expect(screen.getByText('Child A1')).toBeTruthy()
  })

  it('applies per-level left padding via pl-{depth+1 * 4}', () => {
    const { container } = render(<SpecTreeItem node={NODE_A} libraryId="lib" depth={2} searchQuery="" />)
    const row = container.querySelector<HTMLElement>('[data-testid="spec-tree-row"]')!
    expect(row.className).toMatch(/pl-12/)
  })
})

describe('SpecTreeItem metadata line (depth === 0)', () => {
  it('renders [version] state beneath the name for depth 0', () => {
    render(<SpecTreeItem node={NODE_A} libraryId="lib" depth={0} searchQuery="" />)
    expect(screen.getByText(/\[1\.0\.0\]/)).toBeTruthy()
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('does NOT render metadata line for depth > 0', () => {
    render(<SpecTreeItem node={NODE_A} libraryId="lib" depth={1} searchQuery="" />)
    expect(screen.queryByText(/\[1\.0\.0\]/)).toBeNull()
    expect(screen.queryByText('Draft')).toBeNull()
  })
})

describe('SpecTreeItem click navigation', () => {
  beforeEach(() => {
    // Reset expansion set between tests (in-memory Zustand store survives localStorage.clear())
    const { result } = renderHook(() => useSpecExpansion())
    act(() => {
      Array.from(result.current.ids).forEach((id) => result.current.setExpanded(id, false))
    })
    useLibraryStore.setState({ selectedSpecificationId: null } as Partial<ReturnType<typeof useLibraryStore.getState>>)
  })

  it('clicking an embedded child row calls setSelectedSpecification with (childId, libraryId)', () => {
    const spy = vi.fn()
    useLibraryStore.setState({ setSelectedSpecification: spy } as Partial<ReturnType<typeof useLibraryStore.getState>>)
    const parent: SpecTreeNode = {
      ...NODE_A,
      children: [{ ...NODE_A, id: 'child-1', name: 'Child 1' }],
    }
    render(<SpecTreeItem node={parent} libraryId="lib-99" depth={0} searchQuery="" />)
    fireEvent.click(screen.getByRole('button', { name: /expand/i }))
    fireEvent.click(screen.getByText('Child 1'))
    expect(spy).toHaveBeenCalledWith('child-1', 'lib-99')
  })

  it('clicking a root row also calls setSelectedSpecification', () => {
    const spy = vi.fn()
    useLibraryStore.setState({ setSelectedSpecification: spy } as Partial<ReturnType<typeof useLibraryStore.getState>>)
    render(<SpecTreeItem node={NODE_A} libraryId="lib-99" depth={0} searchQuery="" />)
    fireEvent.click(screen.getByText('Workflow A'))
    expect(spy).toHaveBeenCalledWith('a', 'lib-99')
  })

  it('applies selection ring when selectedSpecificationId matches node.id', () => {
    useLibraryStore.setState({
      selectedSpecificationId: 'a',
      setSelectedSpecification: vi.fn(),
    } as Partial<ReturnType<typeof useLibraryStore.getState>>)
    const { container } = render(<SpecTreeItem node={NODE_A} libraryId="lib" depth={0} searchQuery="" />)
    const row = container.querySelector<HTMLElement>('[data-testid="spec-tree-row"]')!
    expect(row.className).toMatch(/border-blue-600/)
  })
})

describe('SpecTreeItem referenced children', () => {
  beforeEach(() => {
    // Reset expansion set between tests (in-memory Zustand store survives localStorage.clear())
    const { result } = renderHook(() => useSpecExpansion())
    act(() => {
      Array.from(result.current.ids).forEach((id) => result.current.setExpanded(id, false))
    })
    vi.mocked(toast.info).mockClear()
  })

  it('renders referenced children with ↗ icon and italic name', () => {
    const node: SpecTreeNode = {
      ...NODE_A,
      referencedChildren: [
        { specId: 'step-1', specName: 'Shared Step', libraryId: 'step-lib', libraryName: 'Shared Steps' },
      ],
    }
    render(<SpecTreeItem node={node} libraryId="lib" depth={0} searchQuery="" />)
    fireEvent.click(screen.getByRole('button', { name: /expand/i }))
    const refRow = screen.getByText('Shared Step')
    expect(refRow.className).toMatch(/italic/)
  })

  it('clicking a referenced child fires a toast and does not call setSelectedSpecification', () => {
    const spy = vi.fn()
    useLibraryStore.setState({ setSelectedSpecification: spy } as Partial<ReturnType<typeof useLibraryStore.getState>>)
    const node: SpecTreeNode = {
      ...NODE_A,
      referencedChildren: [
        { specId: 'step-1', specName: 'Shared Step', libraryId: 'step-lib', libraryName: 'Shared Steps' },
      ],
    }
    render(<SpecTreeItem node={node} libraryId="lib" depth={0} searchQuery="" />)
    fireEvent.click(screen.getByRole('button', { name: /expand/i }))
    fireEvent.click(screen.getByText('Shared Step'))
    expect(toast.info).toHaveBeenCalledWith('Referenced workflows are only editable from the Step Workflow library')
    expect(spy).not.toHaveBeenCalledWith('step-1', expect.anything())
  })
})

const authorPrincipal: MePrincipal = {
  userId: 'u1',
  isAdministrator: false,
  memberships: ['lib'],
  rightsByTeam: { lib: ['workflow:edit', 'workflow:create', 'workflow:delete'] },
  teams: [{ id: 'lib', name: 'Lib' }],
  editLockedStates: ['Approved', 'Effective', 'Superseded', 'Obsolete'],
}
const testLibrary = { teamId: 'lib', entityType: 'workflow' as const }

describe('SpecTreeItem kebab menu', () => {
  it('shows kebab menu on root (depth === 0) rows when user has write capability', () => {
    usePrincipalStore.setState({ principal: authorPrincipal })
    render(
      <SpecTreeItem
        node={NODE_A}
        libraryId="lib"
        depth={0}
        searchQuery=""
        library={testLibrary}
        onDelete={vi.fn()}
        onChangeState={vi.fn()}
        onCreateVersion={vi.fn()}
        onExportPDF={vi.fn()}
      />,
    )
    const row = screen.getByTestId('spec-tree-row')
    expect(row.querySelector('[aria-label="Item actions"]')).not.toBeNull()
  })

  it('hides kebab menu on child rows (depth > 0)', () => {
    usePrincipalStore.setState({ principal: authorPrincipal })
    render(
      <SpecTreeItem
        node={NODE_A}
        libraryId="lib"
        depth={1}
        searchQuery=""
        library={testLibrary}
        onDelete={vi.fn()}
        onChangeState={vi.fn()}
        onCreateVersion={vi.fn()}
        onExportPDF={vi.fn()}
      />,
    )
    const row = screen.getByTestId('spec-tree-row')
    expect(row.querySelector('[aria-label="Item actions"]')).toBeNull()
  })
})

describe('SpecTreeItem search behaviour', () => {
  it('auto-expands ancestors of a matching node when searchQuery is non-empty', () => {
    const tree: SpecTreeNode = {
      ...NODE_A,
      id: 'root',
      name: 'Root',
      children: [
        { ...NODE_A, id: 'branch', name: 'Branch', children: [{ ...NODE_A, id: 'leaf', name: 'Needle in haystack' }] },
      ],
    }
    render(<SpecTreeItem node={tree} libraryId="lib" depth={0} searchQuery="needle" />)
    // Match + ancestors are visible without any click.
    expect(screen.getByText('Needle in haystack')).toBeTruthy()
    expect(screen.getByText('Branch')).toBeTruthy()
  })

  it('dims non-matching siblings with opacity-50', () => {
    const tree: SpecTreeNode = {
      ...NODE_A,
      id: 'root',
      name: 'Root',
      children: [
        { ...NODE_A, id: 'match', name: 'needle-match' },
        { ...NODE_A, id: 'other', name: 'other sibling' },
      ],
    }
    render(<SpecTreeItem node={tree} libraryId="lib" depth={0} searchQuery="needle" />)
    const otherRow = screen.getByText('other sibling').closest('[data-testid="spec-tree-row"]')!
    expect(otherRow.className).toMatch(/opacity-50/)
    const matchRow = screen.getByText('needle-match').closest('[data-testid="spec-tree-row"]')!
    expect(matchRow.className).not.toMatch(/opacity-50/)
  })
})
