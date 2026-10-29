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
 * The import report has to say what the reconciliation did — a re-keyed
 * environment, actions re-keyed to a new oid, actions kept although missing
 * from the package, signature flags to review — not only "created/updated".
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UploadReport } from './UploadReport'
import type { UploadResult } from '@/lib/types'

const full: UploadResult = {
  imported: [
    {
      type: 'environment',
      oid: 'e2',
      local_id: 'Kitchen',
      version: '2.0',
      actions_count: 3,
      status: 'updated',
      rekeyed_from: 'e1',
    },
    { type: 'action', oid: 'a9', local_id: 'Solo', version: '1.0', status: 'created' },
  ],
  errors: [{ filename: 'bad.WFenvir', error: 'invalid JSON' }],
  diff: {
    added: ['Chop'],
    removed: ['Old'],
    modified: ['Bake'],
    rekeyed: ['Mix'],
    orphaned: ['Bake'],
    signature_changed: ['Mix'],
  },
}

describe('UploadReport', () => {
  it('lists imported items, the environment re-key note, and every non-empty reconciliation line', () => {
    render(<UploadReport result={full} />)
    expect(screen.getByText('Environment: Kitchen v2.0')).toBeInTheDocument()
    expect(screen.getByText('Action: Solo v1.0')).toBeInTheDocument()
    expect(screen.getByText('updated')).toBeInTheDocument()
    expect(screen.getByText('created')).toBeInTheDocument()
    expect(screen.getByText(/re-keyed from an earlier import/i)).toBeInTheDocument()
    expect(screen.getByText('Re-keyed to a new OID, code kept: Mix')).toBeInTheDocument()
    expect(screen.getByText('Kept although missing from the package: Bake')).toBeInTheDocument()
    expect(
      screen.getByText('Signature changed, review in the environment: Mix')
    ).toBeInTheDocument()
    expect(screen.getByText('Removed: Old')).toBeInTheDocument()
    expect(screen.getByText('bad.WFenvir: invalid JSON')).toBeInTheDocument()
  })

  it('omits empty categories and the re-key note for a plain update', () => {
    render(
      <UploadReport
        result={{
          imported: [
            {
              type: 'environment',
              oid: 'e1',
              local_id: 'Kitchen',
              version: '1.0',
              status: 'updated',
              rekeyed_from: null,
            },
          ],
          errors: [],
          diff: {
            added: [],
            removed: [],
            modified: [],
            rekeyed: [],
            orphaned: [],
            signature_changed: [],
          },
        }}
      />
    )
    expect(screen.queryByText(/re-keyed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/missing from the package/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/signature changed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/removed:/i)).not.toBeInTheDocument()
  })

  it('tolerates a result without a diff', () => {
    render(<UploadReport result={{ imported: [], errors: [] }} />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})
