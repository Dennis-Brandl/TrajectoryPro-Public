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

// Spec 2026-10-21 §6: refused .WFlibX rows offer no Replace, and the import report lists them.

if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkflowLibraryImportDialog } from '@/components/import/WorkflowLibraryImportDialog'
import { PostImportReportDialog } from '@/components/import/PostImportReportDialog'
import { importToastMessage, needsImportReport } from '@/components/import/import-report-summary'
import type { ImportPlan, ImportPlanRow, PostImportReport } from '@/types/wflibx-import'
import { usePrincipalStore } from '@/stores/principalStore'
import { useLibraryStore } from '@/stores/libraryStore'

function conflict(oid: string): ImportPlanRow {
  return {
    kind: 'specification',
    entityType: 'workflow',
    bundleOid: oid,
    bundleName: `Spec ${oid}`,
    bundleVersion: '1.0.0',
    parentLibraryOid: 'L1',
    status: { tag: 'conflict', existingOid: `X-${oid}`, existingName: `Spec ${oid}`, existingVersion: '0.9.0' },
  }
}

function refused(oid: string, reason: 'locked' | 'no-permission'): ImportPlanRow {
  return {
    kind: 'specification',
    entityType: 'workflow',
    bundleOid: oid,
    bundleName: `Spec ${oid}`,
    bundleVersion: '1.0.0',
    parentLibraryOid: 'L1',
    status: {
      tag: 'refused',
      existingOid: `X-${oid}`,
      existingName: `Spec ${oid}`,
      existingVersion: '1.0.0',
      existingState: 'Effective',
      refusal: {
        reason,
        blockers:
          reason === 'locked'
            ? [{ specId: `X-${oid}`, name: `Spec ${oid}`, version: '1.0.0', state: 'Effective', why: 'is-locked' }]
            : [],
      },
    },
  }
}

function plan(rows: ImportPlanRow[]): ImportPlan {
  return { previewId: 'p1', bundleLibraryName: 'My Lib', warnings: [], rows }
}

const emptyReport: PostImportReport = {
  created: { libraries: 0, specifications: 2 },
  replaced: { libraries: 0, specifications: 1 },
  kept: { libraries: 0, specifications: 0 },
  noOp: { libraries: 0, specifications: 0 },
  warnings: [],
  danglingReferences: [],
  refused: [],
}

beforeEach(() => {
  usePrincipalStore.setState({
    principal: {
      userId: 'u1',
      isAdministrator: false,
      memberships: ['team-a'],
      rightsByTeam: { 'team-a': ['workflow:library.create'] },
      teams: [{ id: 'team-a', name: 'Team A' }],
      editLockedStates: [],
    },
  })
  useLibraryStore.setState({ selectedTeamId: 'team-a' })
})

describe('WorkflowLibraryImportDialog — refused rows', () => {
  it('shows the exact labels and no Replace control', () => {
    render(
      <WorkflowLibraryImportDialog
        open
        plan={plan([refused('R1', 'locked'), refused('R2', 'no-permission')])}
        onCommit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Released — will not be replaced')).toBeTruthy()
    expect(screen.getByText('No permission to replace')).toBeTruthy()
    expect(screen.queryByLabelText('Replace R1')).toBeNull()
    expect(screen.queryByLabelText('Keep R1')).toBeNull()
    expect(screen.queryByLabelText('Replace R2')).toBeNull()
    // Nothing to resolve, so Import is enabled straight away.
    expect((screen.getByRole('button', { name: /^import$/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('"Replace all" sends replace for the nine Drafts and nothing for the refused row', () => {
    const drafts = Array.from({ length: 9 }, (_, i) => conflict(`D${i}`))
    const onCommit = vi.fn()
    render(
      <WorkflowLibraryImportDialog
        open
        plan={plan([refused('R1', 'locked'), ...drafts])}
        onCommit={onCommit}
        onCancel={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /replace all with imported/i }))
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    const expected = Object.fromEntries(drafts.map((d) => [d.bundleOid, 'replace']))
    expect(onCommit).toHaveBeenCalledWith(expected, 'team-a')
  })
})

describe('PostImportReportDialog — refused specs', () => {
  const report: PostImportReport = {
    ...emptyReport,
    refused: [{ oid: 'X-R1', name: 'Mixing', version: '1.2.0', state: 'Effective', reason: 'locked' }],
  }

  it('lists each refused spec with name, version, state and reason', () => {
    render(<PostImportReportDialog open report={report} onClose={() => {}} />)
    const item = screen.getByText(/Mixing/)
    expect(item.textContent).toContain('1.2.0')
    expect(item.textContent).toContain('Effective')
    expect(item.textContent).toContain('Released — will not be replaced')
  })

  it('opens for refused specs alone, and the toast counts them', () => {
    expect(needsImportReport(emptyReport)).toBe(false)
    expect(needsImportReport(report)).toBe(true)
    expect(importToastMessage('My Lib', emptyReport)).toBe('Imported "My Lib" — 2 created, 1 replaced')
    expect(importToastMessage('My Lib', report)).toBe('Imported "My Lib" — 2 created, 1 replaced, 1 refused')
  })
})

describe('changed since export', () => {
  const changed: ImportPlanRow = {
    kind: 'specification',
    entityType: 'workflow',
    bundleOid: 'KD2',
    bundleName: 'Kitchen Demo',
    bundleVersion: '2.0.0',
    parentLibraryOid: 'L1',
    status: {
      tag: 'refused',
      existingOid: 'KD2',
      existingName: 'Kitchen Demo',
      existingVersion: '2.0.0',
      existingState: 'Obsolete',
      refusal: { reason: 'changed-since-export', blockers: [], fileState: 'Effective', effectiveVersionHere: '3.0.0' },
    },
  }

  it('the preview says what changed and which version is Effective here', () => {
    render(<WorkflowLibraryImportDialog open plan={plan([changed])} onCommit={() => {}} onCancel={() => {}} />)
    expect(screen.getByText('Changed here since export — will not be changed')).toBeTruthy()
    expect(screen.getByText('File: Effective · Here: Obsolete · Effective here: v3.0.0')).toBeTruthy()
    expect(screen.queryByLabelText('Replace KD2')).toBeNull()
  })

  it('the report lists it with the same detail', () => {
    const report: PostImportReport = {
      ...emptyReport,
      refused: [
        {
          oid: 'KD2',
          name: 'Kitchen Demo',
          version: '2.0.0',
          state: 'Obsolete',
          reason: 'changed-since-export',
          fileVersion: '2.0.0',
          fileState: 'Effective',
          effectiveVersionHere: '3.0.0',
        },
      ],
    }
    render(<PostImportReportDialog open report={report} onClose={() => {}} />)
    const item = screen.getByText(/Kitchen Demo/)
    expect(item.textContent).toContain('Changed here since export — will not be changed')
    expect(item.textContent).toContain('File: Effective · Here: Obsolete · Effective here: v3.0.0')
  })

  it('a version relabel shows both versions', () => {
    render(
      <WorkflowLibraryImportDialog
        open
        plan={plan([
          {
            ...changed,
            bundleVersion: '1.0.0',
            status: {
              ...(changed.status as Extract<ImportPlanRow['status'], { tag: 'refused' }>),
              existingState: 'Draft',
              refusal: { reason: 'changed-since-export', blockers: [], fileState: 'Draft' },
            },
          },
        ])}
        onCommit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('File: v1.0.0 Draft · Here: v2.0.0 Draft')).toBeTruthy()
  })
})
