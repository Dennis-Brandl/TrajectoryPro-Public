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

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { NodeInlineEditor } from '../NodeInlineEditor'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import type { NodeType, StepNodeData } from '@/types/nodes'
import type { Specification } from '@/types/library'

// NodeInlineEditor always lazily mounts ScriptEditorModal, which pulls in CodeMirror + useTheme
// (window.matchMedia, absent in jsdom). These tests only assert which accordion sections render,
// so stub the modal out (same pattern as DetailView tests mocking heavy children).
vi.mock('../ScriptEditorModal', () => ({ ScriptEditorModal: () => null }))

function renderPanel(nodeType: NodeType, data: Partial<StepNodeData> = {}, isReferencedSubWorkflow = false) {
  return render(
    <ReactFlowProvider>
      <NodeInlineEditor
        nodeType={nodeType}
        nodeId="n1"
        initialData={{ label: 'X', stepType: nodeType, ...data } as StepNodeData}
        initialChildData={null}
        isEmbeddedSubWorkflow={false}
        isReferencedSubWorkflow={isReferencedSubWorkflow}
      />
    </ReactFlowProvider>,
  )
}

describe('NodeInlineEditor — Value Properties visibility', () => {
  beforeEach(() => useFlowStore.setState({ nodes: [], edges: [] }))

  it('hides Value Properties on a Select 1 step', () => {
    renderPanel('select1')
    expect(screen.queryByText('Value Properties')).toBeNull()
  })

  it('hides Value Properties on an Action Proxy step', () => {
    renderPanel('actionProxyWait')
    expect(screen.queryByText('Value Properties')).toBeNull()
  })

  it('still shows Value Properties on a Workflow Proxy (sub-workflow) step', () => {
    renderPanel('workflowProxy')
    expect(screen.getByText('Value Properties')).toBeTruthy()
  })
})

describe('NodeInlineEditor — TRY section visibility', () => {
  beforeEach(() => useFlowStore.setState({ nodes: [], edges: [] }))

  // workflowProxy joined TRY_CAPABLE_NODE_TYPES 2026-08-22 (workflow-level TRY fallback
  // spec D3): escalated child-workflow failures route through the proxy's own TRY rows.
  it.each(['actionProxyWait', 'scriptStep', 'userInteractionStep', 'yesNoStep', 'workflowProxy'] as const)(
    'shows TRY / Error Handling on %s',
    (nt) => {
      renderPanel(nt)
      expect(screen.getByText('TRY / Error Handling')).toBeTruthy()
    },
  )
})

describe('NodeInlineEditor — Gate section (GATE follow-up item 8b)', () => {
  beforeEach(() => useFlowStore.setState({ nodes: [], edges: [] }))

  // The Accordion.Root uses defaultValue={[]} (all sections start collapsed) and
  // CollapsibleSection's Accordion.Content has no forceMount, so Radix (per its
  // Collapsible internals: `children: isOpen && children`) does not mount the
  // section's contents until its trigger is clicked — expand it first.
  // NodeInlineEditor also wraps the lazily imported (and mocked) ScriptEditorModal in an
  // unconditional Suspense on every render; flush that resolution before querying, or React
  // reports the load as an un-act()ed update.
  async function openGate(nodeType: NodeType, data: Partial<StepNodeData> = {}, isReferencedSubWorkflow = false) {
    renderPanel(nodeType, data, isReferencedSubWorkflow)
    await act(async () => {})
    fireEvent.click(await screen.findByText('Gate'))
  }

  it('renders only for gateStep: cycle time defaults to 5, Control Previous Action is off, Edit Script is offered', async () => {
    await openGate('gateStep')
    const cycle = screen.getByLabelText('Cycle time (seconds)') as HTMLInputElement
    expect(cycle.value).toBe('5')
    const control = screen.getByLabelText('Control Previous Action') as HTMLInputElement
    expect(control.checked).toBe(false)
    expect(control.disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Edit Script' })).toBeTruthy()
  })

  it('shows the stored cycle time and flag, and edits both', async () => {
    await openGate('gateStep', { gateCycleSeconds: 30, gateControlPreviousAction: true } as Partial<StepNodeData>)
    const cycle = screen.getByLabelText('Cycle time (seconds)') as HTMLInputElement
    expect(cycle.value).toBe('30')
    const control = screen.getByLabelText('Control Previous Action') as HTMLInputElement
    expect(control.checked).toBe(true)
    fireEvent.change(cycle, { target: { value: '12' } })
    expect(cycle.value).toBe('12')
    fireEvent.change(cycle, { target: { value: '0' } }) // below the minimum → falls back to 5
    expect(cycle.value).toBe('5')
    fireEvent.click(control)
    expect(control.checked).toBe(false)
  })

  it('Mode defaults to Condition: no Delay boxes', async () => {
    await openGate('gateStep')
    expect((screen.getByLabelText('Mode') as HTMLSelectElement).value).toBe('condition')
    expect(screen.queryByLabelText('Weeks')).toBeNull()
  })

  it('choosing Timer shows the Delay boxes and hides Cycle time and Edit Script', async () => {
    await openGate('gateStep')
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'timer' } })
    expect(screen.getByLabelText('Weeks')).toBeTruthy()
    expect(screen.queryByLabelText('Cycle time (seconds)')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit Script' })).toBeNull()
    expect(screen.getByLabelText('Control Previous Action')).toBeTruthy()
  })

  it('condition_or_timer shows Delay boxes, Cycle time, Edit Script and the total read-back', async () => {
    await openGate('gateStep', {
      gateMode: 'condition_or_timer',
      gateDelay: { hours: 2, minutes: 10, seconds: 20 },
    } as Partial<StepNodeData>)
    expect(screen.getByLabelText('Weeks')).toBeTruthy()
    expect(screen.getByLabelText('Cycle time (seconds)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit Script' })).toBeTruthy()
    expect(screen.getByText('Total: 2 h 10 min 20 s')).toBeTruthy()
  })

  it('a referenced sub-workflow cannot change Control Previous Action', async () => {
    await openGate('gateStep', {}, true)
    expect((screen.getByLabelText('Control Previous Action') as HTMLInputElement).disabled).toBe(true)
  })

  it('no Gate section on a script step', async () => {
    renderPanel('scriptStep')
    await act(async () => {})
    expect(screen.queryByText('Gate')).toBeNull()
  })
})

describe('NodeInlineEditor — Input Parameters picker offers Action Properties on every parameterized step (spec 2026-09-04 §5.2.3)', () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [] })
    const env = {
      id: 'env-1',
      libraryId: 'lib-env',
      name: 'Kitchen',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      data: { actionProperties: [{ id: 'ap-1', name: 'Sensor', entries: [{ id: 'e1', name: 'Value', value: '' }] }] },
      history: [],
      createdAt: 0,
      updatedAt: 0,
    } as Specification
    const wf = {
      ...env,
      id: 'wf-1',
      libraryId: 'lib-wf',
      name: 'Flow',
      data: { environmentSpecIds: ['env-1'] },
    } as Specification
    useLibraryStore.setState({
      specifications: new Map([
        ['lib-env', [env]],
        ['lib-wf', [wf]],
      ]),
      selectedSpecificationId: 'wf-1',
    })
  })

  it.each(['scriptStep', 'gateStep', 'actionProxyWait', 'userInteractionStep'] as const)('on %s', async (nt) => {
    renderPanel(nt, {
      inputs: [{ id: 'i1', name: 'level', valueType: 'property', value: '', description: '' }],
    } as Partial<StepNodeData>)
    await act(async () => {})
    fireEvent.click(await screen.findByText('Input Parameters')) // Radix content mounts on expand
    const triggers = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-haspopup') === 'menu')
    fireEvent.pointerDown(triggers[0], { button: 0, ctrlKey: false })
    fireEvent.click(triggers[0])
    expect(await screen.findByText('Env: Kitchen (Action Properties)')).toBeTruthy()
  })
})

describe('NodeInlineEditor — SELECT 1 sections (spec 2026-09-04 §5.2.4)', () => {
  beforeEach(() => useFlowStore.setState({ nodes: [], edges: [] }))

  it('renders Input Parameters but not Output Parameters', async () => {
    renderPanel('select1')
    expect(await screen.findByText('Input Parameters')).toBeTruthy()
    expect(screen.queryByText('Output Parameters')).toBeNull()
  })
})

describe('NodeInlineEditor — Script section: Repeat until done (spec 2026-10-13 §6.6)', () => {
  beforeEach(() => useFlowStore.setState({ nodes: [], edges: [] }))

  async function openScript(data: Partial<StepNodeData> = {}) {
    renderPanel('scriptStep', data)
    await act(async () => {})
    fireEvent.click(await screen.findByText('Script'))
  }

  it('starts off: one-shot, Edit Script offered, no repeat settings', async () => {
    await openScript()
    expect((screen.getByLabelText('Repeat until done') as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByLabelText('Check every (seconds)')).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit Script' })).toBeTruthy()
  })

  it('turning it on shows the cycle (5) and the time-limit boxes reading "No time limit"', async () => {
    await openScript()
    fireEvent.click(screen.getByLabelText('Repeat until done'))
    expect((screen.getByLabelText('Check every (seconds)') as HTMLInputElement).value).toBe('5')
    expect(screen.getByLabelText('Weeks')).toBeTruthy()
    expect(screen.getByText('No time limit')).toBeTruthy()
    expect(screen.queryByLabelText('When the time limit is reached')).toBeNull()
  })

  it('a time limit offers what happens when it is reached (default: fail the step)', async () => {
    await openScript({ scriptRepeat: true, scriptTimeLimit: { hours: 2 } } as Partial<StepNodeData>)
    expect(screen.getByText('Total: 2 h')).toBeTruthy()
    const select = screen.getByLabelText('When the time limit is reached') as HTMLSelectElement
    expect(select.value).toBe('error')
    fireEvent.change(select, { target: { value: 'complete' } })
    expect(select.value).toBe('complete')
  })
})
