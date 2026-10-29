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

/**
 * The import flags an environment re-import can leave on an action:
 *   - signature_change: the input/output signature no longer matches the one
 *     the authored code was written against → list the changes, let the
 *     author mark it resolved once the code is fixed.
 *   - orphaned_at: the action vanished from the package but kept its code →
 *     say so, offer a (confirmed) delete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ActionImportFlag, ActionImportBadges } from './ActionImportFlag'
import { ActionsTable } from '@/features/environments/EnvironmentDetailPage'
import type { ActionSummaryInEnvironment, SignatureChange } from '@/lib/types'

const resolveSignatureChange = vi.fn()
const deleteAction = vi.fn()

vi.mock('@/lib/api', () => ({
  api: {
    resolveSignatureChange: (...args: unknown[]) => resolveSignatureChange(...args),
    deleteAction: (...args: unknown[]) => deleteAction(...args),
  },
}))

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

const signatureChange: SignatureChange = {
  flagged_at: '2026-09-02T10:00:00.000Z',
  baseline_input_parameter_specifications: [],
  baseline_output_parameter_specifications: [],
  changes: ['input `count` type integer → number', 'output `result` removed'],
}

const base = {
  oid: 'a1',
  local_id: 'Mix',
  signature_change: null,
  orphaned_at: null,
}

beforeEach(() => {
  resolveSignatureChange.mockReset()
  deleteAction.mockReset()
})

describe('ActionImportFlag', () => {
  it('renders nothing when the action carries no import flag', () => {
    const { container } = wrap(<ActionImportFlag action={base} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists the signature changes and resolves the flag on Mark resolved', async () => {
    resolveSignatureChange.mockResolvedValue({ oid: 'a1', signature_change: null })
    wrap(<ActionImportFlag action={{ ...base, signature_change: signatureChange }} />)

    expect(screen.getByText('Signature changed on import')).toBeInTheDocument()
    expect(screen.getByText('input `count` type integer → number')).toBeInTheDocument()
    expect(screen.getByText('output `result` removed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }))
    await waitFor(() => expect(resolveSignatureChange).toHaveBeenCalledWith('a1'))
  })

  it('explains an orphaned action and deletes it only after inline confirmation', async () => {
    deleteAction.mockResolvedValue({ deleted: true, action_oid: 'a1' })
    const onDeleted = vi.fn()
    wrap(
      <ActionImportFlag
        action={{ ...base, orphaned_at: '2026-09-02T11:00:00.000Z' }}
        onDeleted={onDeleted}
      />
    )

    expect(screen.getByText('Not in the last import')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteAction).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(deleteAction).toHaveBeenCalledWith('a1'))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
  })

  it('shows both notes when an orphan also has a signature change', () => {
    wrap(
      <ActionImportFlag
        action={{
          ...base,
          signature_change: signatureChange,
          orphaned_at: '2026-09-02T11:00:00.000Z',
        }}
      />
    )
    expect(screen.getByText('Signature changed on import')).toBeInTheDocument()
    expect(screen.getByText('Not in the last import')).toBeInTheDocument()
  })

  it('surfaces a failed resolve instead of swallowing it', async () => {
    resolveSignatureChange.mockRejectedValue(new Error('boom'))
    wrap(<ActionImportFlag action={{ ...base, signature_change: signatureChange }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }))
    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})

describe('ActionImportBadges', () => {
  it('renders one badge per flag and nothing for a clean action', () => {
    const { container, rerender } = wrap(<ActionImportBadges action={base} />)
    expect(container).toBeEmptyDOMElement()

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ActionImportBadges
            action={{ ...base, signature_change: signatureChange, orphaned_at: '2026-09-02' }}
          />
        </MemoryRouter>
      </QueryClientProvider>
    )
    expect(screen.getByText('Signature changed')).toBeInTheDocument()
    expect(screen.getByText('Not in last import')).toBeInTheDocument()
  })
})

describe('ActionsTable (Environment pane)', () => {
  const rows: ActionSummaryInEnvironment[] = [
    {
      oid: 'a1',
      local_id: 'Mix',
      version: '2.0',
      action_visibility: 'observable',
      input_param_count: 2,
      output_param_count: 0,
      states_with_code: ['EXECUTING'],
      signature_change: signatureChange,
      orphaned_at: null,
    },
    {
      oid: 'a2',
      local_id: 'Bake',
      version: '1.0',
      action_visibility: 'opaque',
      input_param_count: 0,
      output_param_count: 0,
      states_with_code: [],
      signature_change: null,
      orphaned_at: null,
    },
  ]

  it('shows the badge and the change note under a flagged row only', () => {
    wrap(<ActionsTable actions={rows} />)
    expect(screen.getByText('Signature changed')).toBeInTheDocument()
    expect(screen.getByText('output `result` removed')).toBeInTheDocument()
    expect(screen.getAllByRole('note')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Bake' })).toBeInTheDocument()
  })
})
