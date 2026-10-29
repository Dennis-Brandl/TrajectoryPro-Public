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

// @vitest-environment jsdom

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import * as Accordion from '@radix-ui/react-accordion'
import { CollapsibleSection } from '../CollapsibleSection'

function renderSection() {
  return render(
    <Accordion.Root type="multiple" defaultValue={[]}>
      <CollapsibleSection value="s1" title="Input Parameters">
        <div>BODY CONTENT</div>
      </CollapsibleSection>
    </Accordion.Root>,
  )
}

describe('CollapsibleSection', () => {
  it('renders the title and hides the body when collapsed by default', () => {
    renderSection()
    expect(screen.getByText('Input Parameters')).toBeTruthy()
    expect(screen.queryByText('BODY CONTENT')).toBeNull()
  })

  it('reveals the body when the trigger is clicked', () => {
    renderSection()
    fireEvent.click(screen.getByText('Input Parameters'))
    expect(screen.getByText('BODY CONTENT')).toBeTruthy()
  })

  it('shows the element count after the title when given, and nothing when omitted', () => {
    render(
      <Accordion.Root type="multiple" defaultValue={[]}>
        <CollapsibleSection value="s1" title="Input Parameters" count={3}>
          <div>A</div>
        </CollapsibleSection>
        <CollapsibleSection value="s2" title="Value Properties" count={0}>
          <div>B</div>
        </CollapsibleSection>
        <CollapsibleSection value="s3" title="Form">
          <div>C</div>
        </CollapsibleSection>
      </Accordion.Root>,
    )
    // The bare title still resolves to exactly one element (its own span) …
    expect(screen.getByText('Input Parameters')).toBeTruthy()
    expect(screen.getByText('(3)')).toBeTruthy()
    // … and a zero count is shown, not suppressed.
    expect(screen.getByText('(0)')).toBeTruthy()
    // The trigger's accessible name carries the count.
    expect(screen.getByRole('button', { name: 'Input Parameters (3)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Form' })).toBeTruthy()
  })
})
