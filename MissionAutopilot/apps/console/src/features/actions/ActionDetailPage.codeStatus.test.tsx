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
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { CodeStatusSection } from './ActionDetailPage'

function renderSection(onShowHistory = vi.fn()) {
  render(
    <MemoryRouter>
      <CodeStatusSection
        actionOid="a1"
        statesWithCode={['IN_PROGRESS']}
        visibility="opaque"
        onClearState={vi.fn()}
        onShowHistory={onShowHistory}
      />
    </MemoryRouter>
  )
  return onShowHistory
}

describe('CodeStatusSection — History button', () => {
  it('shows a History button only on states that have code', () => {
    renderSection()
    const historyButtons = screen.getAllByRole('button', { name: 'History' })
    expect(historyButtons.length).toBe(1)
    // Sanity: the row without code still renders its Edit link but no History
    expect(screen.getAllByText('Edit').length).toBeGreaterThan(1)
  })

  it('reports the clicked state via onShowHistory', () => {
    const spy = renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(spy).toHaveBeenCalledWith('IN_PROGRESS')
  })
})
