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
import { TimerSection } from '../TimerSection'
import type { TimerBlock } from '@mission/form-schema'
import { createDefaultBlock } from '@/lib/form-document/create-block'

const block: TimerBlock = {
  id: 'b',
  type: 'timer',
  label: 'Cure',
  fieldName: 't',
  durationSeconds: 60,
  direction: 'countdown',
}

describe('TimerSection', () => {
  it('toggles blockDone', () => {
    const onUpdate = vi.fn()
    render(<TimerSection block={block} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByLabelText(/block.*done|gate/i))
    expect(onUpdate).toHaveBeenCalledWith({ blockDone: true })
  })

  it('edits the label', () => {
    const onUpdate = vi.fn()
    render(<TimerSection block={block} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: 'Bake' } })
    expect(onUpdate).toHaveBeenCalledWith({ label: 'Bake' })
  })

  it('switches direction to countup', () => {
    const onUpdate = vi.fn()
    render(<TimerSection block={block} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('button', { name: /countup/i }))
    expect(onUpdate).toHaveBeenCalledWith({ direction: 'countup' })
  })

  it('recomposes durationSeconds when the minutes field changes', () => {
    const onUpdate = vi.fn()
    render(<TimerSection block={block} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByLabelText(/^m$/i), { target: { value: '2' } })
    expect(onUpdate).toHaveBeenCalledWith({ durationSeconds: 120 })
  })

  it('edits timer fieldName and size', () => {
    const block = createDefaultBlock('timer')
    const onUpdate = vi.fn()
    render(<TimerSection block={block} onUpdate={onUpdate} allBlocks={[block]} />)
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: 'lg' } })
    expect(onUpdate).toHaveBeenCalledWith({ size: 'lg' })
  })
})
