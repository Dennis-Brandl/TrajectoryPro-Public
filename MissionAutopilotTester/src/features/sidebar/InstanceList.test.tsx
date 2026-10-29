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
import { useEffect } from 'react'
import { renderWithProviders } from '../../test-utils'
import { useActiveInstance } from '../../store/active-instance'
import { InstanceList } from './InstanceList'

function seedConnection() {
  localStorage.setItem(
    'mission-tester:connections:v1',
    JSON.stringify({
      connections: [
        { id: 'c1', url: 'http://localhost:3000', createdAt: '2026-05-13T00:00:00Z' },
      ],
      activeConnectionId: 'c1',
    })
  )
}

function HarnessWithTracked({ count }: { count: number }) {
  const { trackInstance } = useActiveInstance()
  useEffect(() => {
    for (let i = 0; i < count; i++) {
      trackInstance({
        instance_id: `instance-id-${i}`,
        connection_id: 'c1',
        action_oid: `act-${i}`,
        last_known_state: i === 0 ? 'COMPLETED' : 'EXECUTING',
      })
    }
  }, [count, trackInstance])
  return <InstanceList />
}

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  localStorage.clear()
})

describe('InstanceList', () => {
  it('shows an idle prompt when no connection is active', () => {
    renderWithProviders(<InstanceList />)
    expect(screen.getByText(/no active connection/i)).toBeInTheDocument()
  })

  it('shows an empty state when no instances are tracked yet', () => {
    seedConnection()
    renderWithProviders(<InstanceList />)
    expect(screen.getByText(/no instances yet/i)).toBeInTheDocument()
  })

  it('renders one row per tracked instance for the active connection', async () => {
    seedConnection()
    renderWithProviders(<HarnessWithTracked count={3} />)
    expect(await screen.findByTestId('instance-row-instance-id-0')).toBeInTheDocument()
    expect(screen.getByTestId('instance-row-instance-id-1')).toBeInTheDocument()
    expect(screen.getByTestId('instance-row-instance-id-2')).toBeInTheDocument()
  })

  it('truncates instance_id to its first 8 characters in the row', async () => {
    seedConnection()
    renderWithProviders(<HarnessWithTracked count={1} />)
    expect(await screen.findByText('instance')).toBeInTheDocument()
  })

  it('click on a row selects the instance and highlights it', async () => {
    const user = userEvent.setup()
    seedConnection()
    renderWithProviders(<HarnessWithTracked count={2} />)
    const row = await screen.findByTestId('instance-row-instance-id-1')
    await user.click(row)
    expect(row.className).toMatch(/active/i)
  })

  it('shows the last_known_state in a state pill', async () => {
    seedConnection()
    renderWithProviders(<HarnessWithTracked count={2} />)
    expect(await screen.findByText('COMPLETED')).toBeInTheDocument()
    expect(screen.getAllByText('EXECUTING').length).toBeGreaterThanOrEqual(1)
  })
})
