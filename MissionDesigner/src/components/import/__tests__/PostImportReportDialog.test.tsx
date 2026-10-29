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

// Radix UI calls hasPointerCapture / releasePointerCapture in jsdom where they are not implemented.
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PostImportReportDialog } from '@/components/import/PostImportReportDialog'
import type { PostImportReport } from '@/types/wflibx-import'

const report: PostImportReport = {
  created: { libraries: 0, specifications: 0 },
  replaced: { libraries: 1, specifications: 0 },
  kept: { libraries: 0, specifications: 0 },
  noOp: { libraries: 0, specifications: 0 },
  warnings: [],
  refused: [],
  danglingReferences: [
    { referrerOid: 'WF1', referrerName: 'Workflow 1', referrerEntityType: 'workflow', brokenReferenceTo: 'ENV-OLD' },
  ],
}

describe('PostImportReportDialog', () => {
  it('renders one row per dangling reference', () => {
    render(<PostImportReportDialog open report={report} onClose={() => {}} />)
    expect(screen.queryByText(/Workflow 1/)).not.toBeNull()
    expect(screen.queryByText(/ENV-OLD/)).not.toBeNull()
  })

  it('Acknowledge button calls onClose', () => {
    const onClose = vi.fn()
    render(<PostImportReportDialog open report={report} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
