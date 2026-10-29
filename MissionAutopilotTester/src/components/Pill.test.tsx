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

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Pill } from './Pill'

describe('Pill', () => {
  it('renders its children', () => {
    render(<Pill>observable</Pill>)
    expect(screen.getByText('observable')).toBeInTheDocument()
  })

  it('applies the neutral variant class by default', () => {
    render(<Pill>x</Pill>)
    expect(screen.getByText('x').className).toMatch(/neutral/)
  })

  it('applies the success variant class when variant=success', () => {
    render(<Pill variant="success">done</Pill>)
    expect(screen.getByText('done').className).toMatch(/success/)
  })

  it('applies the error variant class when variant=error', () => {
    render(<Pill variant="error">err</Pill>)
    expect(screen.getByText('err').className).toMatch(/error/)
  })
})
