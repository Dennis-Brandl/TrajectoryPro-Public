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

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { WhereYouAre } from '../WhereYouAre'
import { whereItems } from '../where'
import { ROOT, liveStep } from './where-fixtures'

afterEach(cleanup)

describe('WhereYouAre (spec §4)', () => {
  it('lists the steps with the current one marked "You are here"', () => {
    const data = { status: 'ready' as const, items: whereItems(ROOT, { weigh: liveStep('COMPLETED') }, 'charge') }
    render(<WhereYouAre runtimeLabel="MIX-20261009-0002" data={data} />)

    const nav = screen.getByRole('navigation', { name: 'Where you are in MIX-20261009-0002' })
    expect([...nav.querySelectorAll('.where-name')].map((n) => n.textContent)).toEqual(['Weigh', 'Charge', 'Heat', 'Side note'])
    expect(nav.querySelector('[aria-current="step"]')!.textContent).toContain('You are here')
    expect(nav.querySelector('.where-title')!.textContent).toBe('Where you are in MIX-20261009-0002')
  })

  it('says when the steps are loading or unavailable', () => {
    const loading = render(<WhereYouAre runtimeLabel="RW-1" data={{ status: 'loading', items: [] }} />)
    expect(screen.getByText('Loading steps…')).toBeTruthy()
    loading.unmount()

    render(<WhereYouAre runtimeLabel="RW-1" data={{ status: 'unavailable', items: [] }} />)
    expect(screen.getByText('Steps are unavailable right now.')).toBeTruthy()
  })
})
