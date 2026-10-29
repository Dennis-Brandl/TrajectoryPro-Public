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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ContextBar, workflowParts } from '../ContextBar'
import type { InboxTask } from '../../api/types'

function task(over: Partial<InboxTask> = {}): InboxTask {
  return {
    assignmentId: 'a1',
    stepInstanceId: 'si1',
    stepOid: 'so1',
    stepType: 'USER_INTERACTION',
    stepName: 'Charge Kettle',
    instanceId: 'i1',
    runtimeNumber: 2,
    runtimeLabel: 'MIX-20261009-0002',
    masterName: 'Batch Mix',
    offeredAt: '2026-10-09T00:00:00.000Z',
    claimedAt: '2026-10-09T00:00:01.000Z',
    suggestedForMe: false,
    paused: false,
    formDocument: null,
    yesNoConfig: null,
    ...over,
  }
}

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

afterEach(() => {
  cleanup()
  setClipboard(undefined)
})

describe('workflowParts', () => {
  it('keeps the innermost sub-flow whole; name, version and parents give way first', () => {
    expect(workflowParts(task())).toEqual(['Batch Mix', ''])
    expect(workflowParts(task({ masterVersion: '3' }))).toEqual(['Batch Mix v3', ''])
    expect(workflowParts(task({ masterVersion: '3', workflowPath: ['Charge sub-flow', 'Inner'] }))).toEqual([
      'Batch Mix v3 › Charge sub-flow › ',
      'Inner',
    ])
  })
})

describe('ContextBar (spec §5.3)', () => {
  const field = (container: HTMLElement, cls: string) => container.querySelector(`.${cls} dd`)!.textContent

  it('shows the four labelled facts; the workflow carries its version and child path', () => {
    const { container } = render(
      <ContextBar task={task({ masterVersion: '3', workflowPath: ['Charge sub-flow'] })} wcName="Mixing Line 2" />,
    )
    expect([...container.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Step', 'Workflow', 'Runtime ID', 'Work center'])
    expect(field(container, 'ctx-step')).toBe('Charge Kettle')
    expect(field(container, 'ctx-workflow')).toBe('Batch Mix v3 › Charge sub-flow')
    expect(field(container, 'ctx-runtime')).toContain('MIX-20261009-0002')
    expect(field(container, 'ctx-wc')).toBe('Mixing Line 2')
  })

  it('a snapshot cached before the payload additions still shows the workflow name', () => {
    const { container } = render(<ContextBar task={task()} wcName="Mixing Line 2" />)
    expect(field(container, 'ctx-workflow')).toBe('Batch Mix')
  })

  it('copy puts the full runtime ID on the clipboard and announces Copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    render(<ContextBar task={task()} wcName="Mixing Line 2" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy runtime ID' }))

    expect(await screen.findByText('Copied')).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith('MIX-20261009-0002')
  })

  it('with no clipboard available it says the copy failed instead of claiming success', async () => {
    setClipboard(undefined)
    render(<ContextBar task={task()} wcName="Mixing Line 2" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy runtime ID' }))

    expect(await screen.findByText('Copy failed — select the ID')).toBeTruthy()
    expect(screen.queryByText('Copied')).toBeNull()
  })
})

describe('ContextBar shortcut', () => {
  it('Ctrl+Shift+C copies the runtime ID like the button does (P4-R3)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    render(<ContextBar task={task()} wcName="Mixing Line 2" />)
    expect(screen.getByRole('button', { name: 'Copy runtime ID' }).getAttribute('aria-keyshortcuts')).toBe('Control+Shift+C')
    fireEvent.keyDown(document.body, { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true })
    expect(writeText).toHaveBeenCalledWith('MIX-20261009-0002')
    expect(await screen.findByText('Copied')).toBeTruthy()
  })
})
