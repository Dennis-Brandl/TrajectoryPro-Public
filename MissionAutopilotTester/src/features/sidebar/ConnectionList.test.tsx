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

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../../test-utils'
import { ConnectionList } from './ConnectionList'

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  localStorage.clear()
})

describe('ConnectionList', () => {
  it('says where Add is when no connections exist', () => {
    renderWithProviders(<ConnectionList />)
    expect(
      screen.getByText((_, el) => el?.tagName === 'P' && el.textContent ===
        'No connections yet. Open the connections menu in the top bar and choose + Add connection.')
    ).toBeInTheDocument()
    expect(screen.getByText('+ Add connection').tagName).toBe('STRONG')
  })

  it('renders one row per saved connection', () => {
    localStorage.setItem(
      'mission-tester:connections:v1',
      JSON.stringify({
        connections: [
          { id: 'a', url: 'http://a', name: 'Alpha', createdAt: '2026-05-13T00:00:00Z' },
          { id: 'b', url: 'http://b', name: 'Beta', createdAt: '2026-05-13T00:00:00Z' },
        ],
        activeConnectionId: 'a',
      })
    )
    renderWithProviders(<ConnectionList />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('highlights the active row', () => {
    localStorage.setItem(
      'mission-tester:connections:v1',
      JSON.stringify({
        connections: [
          { id: 'a', url: 'http://a', name: 'Alpha', createdAt: '2026-05-13T00:00:00Z' },
          { id: 'b', url: 'http://b', name: 'Beta', createdAt: '2026-05-13T00:00:00Z' },
        ],
        activeConnectionId: 'b',
      })
    )
    renderWithProviders(<ConnectionList />)
    const betaRow = screen.getByTestId('sidebar-conn-b')
    expect(betaRow.className).toMatch(/active/i)
  })

  it('selects a connection on click', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'mission-tester:connections:v1',
      JSON.stringify({
        connections: [
          { id: 'a', url: 'http://a', name: 'Alpha', createdAt: '2026-05-13T00:00:00Z' },
          { id: 'b', url: 'http://b', name: 'Beta', createdAt: '2026-05-13T00:00:00Z' },
        ],
        activeConnectionId: 'a',
      })
    )
    renderWithProviders(<ConnectionList />)
    await user.click(screen.getByText('Beta'))
    const betaRow = screen.getByTestId('sidebar-conn-b')
    expect(betaRow.className).toMatch(/active/i)
  })
})
