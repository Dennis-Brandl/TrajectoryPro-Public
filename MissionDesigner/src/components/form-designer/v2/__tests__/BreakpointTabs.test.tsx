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
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BreakpointTabs, BREAKPOINT_FRAME_WIDTH } from '../BreakpointTabs'
import { useFormDocumentStore } from '@/stores/formDocumentStore'

beforeEach(() => useFormDocumentStore.getState().close())

describe('BreakpointTabs', () => {
  it('maps the three breakpoints to frame widths', () => {
    expect(BREAKPOINT_FRAME_WIDTH).toEqual({ base: 1152, tablet: 768, phone: 390 })
  })
  it('switches the active breakpoint on click', () => {
    render(<BreakpointTabs />)
    fireEvent.click(screen.getByRole('button', { name: /phone/i }))
    expect(useFormDocumentStore.getState().activeBreakpoint).toBe('phone')
  })
})
