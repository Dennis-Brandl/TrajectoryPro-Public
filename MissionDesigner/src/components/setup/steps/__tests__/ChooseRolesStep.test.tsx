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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChooseRolesStep } from '../ChooseRolesStep'
import * as adminClient from '@/lib/admin/adminClient'

vi.mock('@/lib/admin/adminClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/adminClient')>()
  return { ...actual, getRoleTemplates: vi.fn(), applyRoleTemplates: vi.fn() }
})

const TEMPLATES = [
  { id: 'role-author', name: 'Author', description: 'a', rights: ['workflow:create'] },
  { id: 'role-approver', name: 'Approver', description: 'b', rights: ['workflow:approve'] },
]

beforeEach(() => {
  vi.mocked(adminClient.getRoleTemplates).mockResolvedValue(TEMPLATES)
  vi.mocked(adminClient.applyRoleTemplates).mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

describe('ChooseRolesStep', () => {
  it('lists templates pre-checked and applies the checked set on Continue', async () => {
    const onNext = vi.fn()
    render(<ChooseRolesStep onNext={onNext} onBack={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText(/Author/)).toBeTruthy())
    const checks = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checks.every((c) => c.checked)).toBe(true)
    // uncheck Approver
    fireEvent.click(screen.getByLabelText(/Approver/))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(adminClient.applyRoleTemplates).toHaveBeenCalledWith(['role-author']))
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})
