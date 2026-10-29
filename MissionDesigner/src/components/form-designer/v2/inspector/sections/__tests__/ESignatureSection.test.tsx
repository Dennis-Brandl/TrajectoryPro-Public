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
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { Block } from '@mission/form-schema'
import { ESignatureSection } from '../ESignatureSection'

vi.mock('@/lib/esignature-roles', () => ({ useESignatureRoles: vi.fn() }))
import { useESignatureRoles } from '@/lib/esignature-roles'

const block = {
  id: 'e1',
  type: 'esignature' as const,
  fieldName: 'approval',
  label: 'Approve',
  meaning: 'I approve',
  roleName: 'QA Lead',
  requireDifferentUser: false,
}

beforeEach(() => {
  vi.mocked(useESignatureRoles).mockReturnValue({ roles: ['QA Lead', 'Supervisor'], loading: false, error: null })
})

describe('ESignatureSection', () => {
  it('renders every field from the block and the role list with the any-member option first', () => {
    render(<ESignatureSection block={block} onUpdate={vi.fn()} allBlocks={[block]} />)
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Approve')
    expect((screen.getByLabelText('Meaning') as HTMLTextAreaElement).value).toBe('I approve')
    const role = screen.getByLabelText('Role') as HTMLSelectElement
    expect([...role.options].map((o) => o.textContent)).toEqual(['Any work-center member', 'QA Lead', 'Supervisor'])
    expect(role.value).toBe('QA Lead')
    expect((screen.getByLabelText('A different user than the operator must sign') as HTMLInputElement).checked).toBe(
      false,
    )
    expect(screen.queryByText(/not in the E-signature roles list/)).toBeNull()
  })

  it('edits every field: debounced label/meaning, role select (empty = any member), flag', () => {
    vi.useFakeTimers()
    const onUpdate = vi.fn()
    render(<ESignatureSection block={block} onUpdate={onUpdate} allBlocks={[block]} />)
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Approve timesheet' } })
    fireEvent.change(screen.getByLabelText('Meaning'), { target: { value: 'I approve this timesheet' } })
    act(() => {
      vi.advanceTimersByTime(350)
    })
    expect(onUpdate).toHaveBeenCalledWith({ label: 'Approve timesheet' })
    expect(onUpdate).toHaveBeenCalledWith({ meaning: 'I approve this timesheet' })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Supervisor' } })
    expect(onUpdate).toHaveBeenCalledWith({ roleName: 'Supervisor' })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: '' } })
    expect(onUpdate).toHaveBeenCalledWith({ roleName: undefined })
    fireEvent.click(screen.getByLabelText('A different user than the operator must sign'))
    expect(onUpdate).toHaveBeenCalledWith({ requireDifferentUser: true })
    vi.useRealTimers()
  })

  it('flags a stored role that is no longer listed (D10) and keeps it selectable', () => {
    render(<ESignatureSection block={{ ...block, roleName: 'Retired Role' }} onUpdate={vi.fn()} allBlocks={[block]} />)
    const role = screen.getByLabelText('Role') as HTMLSelectElement
    expect(role.value).toBe('Retired Role')
    expect([...role.options].map((o) => o.textContent)).toContain('Retired Role (not in the E-signature roles list)')
    expect(screen.getByRole('status').textContent).toContain('not in the E-signature roles list')
  })

  it('does not flag a valid stored role as unlisted while the roles list is still loading', () => {
    vi.mocked(useESignatureRoles).mockReturnValue({ roles: [], loading: true, error: null })
    render(<ESignatureSection block={block} onUpdate={vi.fn()} allBlocks={[block]} />)
    const role = screen.getByLabelText('Role') as HTMLSelectElement
    expect(role.value).toBe('QA Lead')
    expect([...role.options].map((o) => o.textContent)).toContain('QA Lead')
    expect(screen.queryByText(/not in the E-signature roles list/)).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('flags the same stored role once loading finishes and it truly is not in the list', () => {
    vi.mocked(useESignatureRoles).mockReturnValue({ roles: [], loading: false, error: null })
    render(<ESignatureSection block={block} onUpdate={vi.fn()} allBlocks={[block]} />)
    const role = screen.getByLabelText('Role') as HTMLSelectElement
    expect(role.value).toBe('QA Lead')
    expect([...role.options].map((o) => o.textContent)).toContain('QA Lead (not in the E-signature roles list)')
    expect(screen.getByRole('status').textContent).toContain('not in the E-signature roles list')
  })

  it('shows the load error instead of the list', () => {
    vi.mocked(useESignatureRoles).mockReturnValue({
      roles: [],
      loading: false,
      error: 'Failed to load e-signature roles (500)',
    })
    render(<ESignatureSection block={block} onUpdate={vi.fn()} allBlocks={[block]} />)
    expect(screen.getByText('Failed to load e-signature roles (500)')).toBeTruthy()
  })
})

// Keeps the union import used (the section takes Block, the test passes a literal).
void (null as unknown as Block)
