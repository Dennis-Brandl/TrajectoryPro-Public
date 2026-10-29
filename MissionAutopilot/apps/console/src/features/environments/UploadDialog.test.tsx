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

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UploadDialog from './UploadDialog'

const mutateAsync = vi.hoisted(() => vi.fn())

vi.mock('./hooks', () => ({
  useUploadPackage: () => ({ mutateAsync }),
}))
// The shared Radix dialog resolves a second copy of React under vitest, so
// the dialog shell is stubbed; the dropzone and validation are what is tested.
vi.mock('@mission/ui', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return {
    Dialog: Pass,
    DialogContent: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
    DialogDescription: Pass,
  }
})
vi.mock('./UploadReport', () => ({ UploadReport: () => <div>report</div> }))

function drop(name: string) {
  render(<UploadDialog open onOpenChange={() => {}} />)
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['x'], name)] } })
}

describe('UploadDialog', () => {
  it('accepts a .WFenvirBundleX file', async () => {
    mutateAsync.mockResolvedValue({ imported: [], errors: [] })
    drop('env.WFenvirBundleX')
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/Invalid file type/)).toBeNull()
  })

  it('rejects a .txt file naming all four extensions', async () => {
    mutateAsync.mockClear()
    drop('notes.txt')
    const msg = await screen.findByText(/Invalid file type: "notes.txt"/)
    for (const ext of ['.WFenvir', '.WFenvirX', '.WFenvirBundleX', '.WFaction']) {
      expect(msg.textContent).toContain(ext)
    }
    expect(mutateAsync).not.toHaveBeenCalled()
  })
  it('says one file at a time when two valid files are dropped', async () => {
    mutateAsync.mockClear()
    render(<UploadDialog open onOpenChange={() => {}} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'a.WFenvirX'), new File(['x'], 'b.WFenvirX')] },
    })
    await screen.findByText('Drop one package file at a time.')
    expect(screen.queryByText(/Invalid file type/)).toBeNull()
    expect(mutateAsync).not.toHaveBeenCalled()
  })
})
