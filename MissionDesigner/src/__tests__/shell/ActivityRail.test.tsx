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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Folder, Settings } from 'lucide-react'
import { ActivityRail } from '@mission/ui'

const items = [
  { id: 'a', label: 'Explorer', icon: Folder },
  { id: 'b', label: 'Config', icon: Settings },
]

describe('ActivityRail', () => {
  it('renders a titled button per item and marks the active one', () => {
    render(<ActivityRail items={items} activeId="b" onSelect={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Explorer' }).getAttribute('title')).toBe('Explorer')
    expect(screen.getByRole('button', { name: 'Config' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Explorer' }).getAttribute('aria-current')).toBeNull()
  })
  it('calls onSelect with the id', async () => {
    const onSelect = vi.fn()
    render(<ActivityRail items={items} activeId={null} onSelect={onSelect} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Explorer' }))
    expect(onSelect).toHaveBeenCalledWith('a')
  })
})
