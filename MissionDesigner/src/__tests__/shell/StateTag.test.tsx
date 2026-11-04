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
import { render, screen } from '@testing-library/react'
import { StateTag } from '@mission/ui'

const MUTED = ['bg-muted', 'text-muted-foreground']
const INFO = ['bg-status-info-bg', 'text-status-info-fg']
const OK = ['bg-status-ok-bg', 'text-status-ok-fg']

describe('StateTag', () => {
  it.each([
    ['Draft', MUTED],
    ['Superseded', MUTED],
    ['Obsolete', MUTED],
    ['InTest', INFO],
    ['InReview', INFO],
    ['Approved', OK],
    ['Effective', OK],
    ['Mystery', MUTED],
    ['approved', OK],
  ])('%s', (state, classes) => {
    render(<StateTag state={state} />)
    const el = screen.getByText(state)
    for (const c of classes) expect(el.classList.contains(c)).toBe(true)
  })
  it('passes title', () => {
    render(<StateTag state="Draft" title="hi" />)
    expect(screen.getByText('Draft').getAttribute('title')).toBe('hi')
  })
})
