// @vitest-environment jsdom
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
import { describe, it, expect } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { App } from '../App'

describe('App', () => {
  it('renders the flow picker and the default (inspection) entry screen', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Inspection (branching)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Kitchen sink (all blocks)' })).toBeTruthy()
    expect(screen.getByRole('textbox')).toBeTruthy() // serial input
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('switches to the kitchen-sink flow', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Kitchen sink (all blocks)' }))
    expect(screen.getByRole('button', { name: 'Retry scan' })).toBeTruthy()
  })
})
