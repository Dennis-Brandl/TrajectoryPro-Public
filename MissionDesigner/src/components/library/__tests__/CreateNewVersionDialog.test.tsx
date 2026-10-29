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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateNewVersionDialog } from '@/components/library/CreateNewVersionDialog'
import * as mutations from '@/lib/api/specification-mutations'
import type { Specification } from '@/types/library'

vi.mock('@/lib/api/specification-mutations')

const spec: Specification = {
  id: 's1',
  libraryId: 'lib1',
  name: 'WP-101',
  description: null,
  version: '1.2.0',
  state: 'Effective',
  data: {},
  history: [],
  createdAt: 0,
  updatedAt: 0,
}

function setVersion(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } })
}

describe('CreateNewVersionDialog', () => {
  beforeEach(() => vi.resetAllMocks())

  it('Patch button pre-fills 1.2.1', () => {
    render(
      <CreateNewVersionDialog spec={spec} siblingVersions={['1.0.0', '1.1.0', '1.2.0']} open onOpenChange={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /patch/i }))
    expect((screen.getByRole('textbox', { name: /new version/i }) as HTMLInputElement).value).toBe('1.2.1')
  })

  it('Minor button pre-fills 1.3.0; Major pre-fills 2.0.0', () => {
    render(<CreateNewVersionDialog spec={spec} siblingVersions={['1.2.0']} open onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /minor/i }))
    expect((screen.getByRole('textbox', { name: /new version/i }) as HTMLInputElement).value).toBe('1.3.0')
    fireEvent.click(screen.getByRole('button', { name: /major/i }))
    expect((screen.getByRole('textbox', { name: /new version/i }) as HTMLInputElement).value).toBe('2.0.0')
  })

  it('Create disabled on invalid semver, on unchanged version, and on collision', () => {
    render(<CreateNewVersionDialog spec={spec} siblingVersions={['1.2.0', '1.3.0']} open onOpenChange={() => {}} />)
    const input = screen.getByRole('textbox', { name: /new version/i }) as HTMLInputElement
    const create = screen.getByRole('button', { name: /create/i }) as HTMLButtonElement

    setVersion(input, 'not-semver')
    expect(create.disabled).toBe(true)

    setVersion(input, '1.2.0')
    expect(create.disabled).toBe(true) // unchanged

    setVersion(input, '1.3.0')
    expect(create.disabled).toBe(true) // collision

    setVersion(input, '1.4.0')
    expect(create.disabled).toBe(false)
  })

  it('calls createNewSpecificationVersion and closes on success', async () => {
    const onOpenChange = vi.fn()
    const onSuccess = vi.fn()
    vi.mocked(mutations.createNewSpecificationVersion).mockResolvedValue({
      ...spec,
      id: 's2',
      version: '1.3.0',
      state: 'Draft',
    })
    render(
      <CreateNewVersionDialog
        spec={spec}
        siblingVersions={['1.2.0']}
        open
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /minor/i }))
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    await waitFor(() => expect(mutations.createNewSpecificationVersion).toHaveBeenCalledWith('s1', '1.3.0'))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onSuccess).toHaveBeenCalled()
  })
})
