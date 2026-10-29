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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { WorkflowsScreen, type WorkflowsScreenProps } from '../WorkflowsScreen'
import { useWorkflowDiagrams } from '../../../workflows-data'
import type {
  PilotRuntimeWorkflow, DiagramSpec, InboxTask, RuntimeWorkflowDiagram, RuntimeWorkflowLiveStates,
} from '../../../api/types'

vi.mock('../../../workflows-data', () => ({ useWorkflowDiagrams: vi.fn() }))

function wf(over: Partial<PilotRuntimeWorkflow> = {}): PilotRuntimeWorkflow {
  return {
    id: 'i1', workCenterId: 'wc1', runtimeNumber: 1, runtimeLabel: 'MIX-20261007-001', masterName: 'Pack',
    masterOid: 'm', masterVersion: '1.0.0',
    masterState: 'Effective', status: 'running', createdByName: null,  createdByLabel: null, createdAt: '2026-08-19T00:00:00Z',
    queuedAt: null, startedAt: null, completedAt: null, activeSteps: [], errorText: null, mine: false, ...over,
  }
}

const CHILD: DiagramSpec = {
  oid: 'c1', name: 'Sub', version: null, state: null, notation: 'flowchart',
  steps: [{ oid: 'cs1', name: 'Inner', stepType: 'START', x: 0, y: 0, childSpecOid: null }],
  connections: [], children: [],
}
const ROOT: DiagramSpec = {
  oid: 'rt_0', name: 'Pack', version: null, state: null, notation: 'flowchart',
  steps: [
    { oid: 's1', name: 'Fill', stepType: 'USER_INTERACTION', x: 0, y: 0, childSpecOid: null },
    { oid: 'sp', name: 'Sub', stepType: 'WORKFLOW PROXY', x: 0, y: 100, childSpecOid: 'c1' },
    { oid: 'g1', name: 'Temp Gate', stepType: 'GATE', x: 0, y: 200, childSpecOid: null },
  ],
  connections: [], children: [CHILD],
}
const DIAGRAM: RuntimeWorkflowDiagram = { instanceId: 'i1', runtimeNumber: 1, runtimeLabel: 'MIX-20261007-001', masterName: 'Pack', root: ROOT }

function liveWith(over: Partial<RuntimeWorkflowLiveStates> = {}): RuntimeWorkflowLiveStates {
  return {
    instanceId: 'i1', status: 'running',
    steps: {
      s1: {
        state: 'WAITING_USER', nodeOid: 'rt_0', error: null,
        assignment: { id: 'a1', status: 'claimed', claimant: { displayName: 'Me' }, mine: true },
      },
    },
    childActive: {}, ...over,
  }
}

function task(over: Partial<InboxTask> = {}): InboxTask {
  return {
    assignmentId: 'a1', stepInstanceId: 'si1', stepOid: 's1', stepType: 'USER_INTERACTION', stepName: 'Fill',
    instanceId: 'i1', runtimeNumber: 1, runtimeLabel: 'MIX-20261007-001', masterName: 'Pack',
    offeredAt: '', claimedAt: '', suggestedForMe: false,
    paused: false, formDocument: null, yesNoConfig: null, ...over,
  }
}

function renderScreen(hook: Partial<ReturnType<typeof useWorkflowDiagrams>>, props: Partial<WorkflowsScreenProps> = {}) {
  vi.mocked(useWorkflowDiagrams).mockReturnValue({
    list: [wf()], diagram: DIAGRAM, live: liveWith(), unavailable: false, ...hook,
  })
  const all: WorkflowsScreenProps = {
    wcId: 'wc1', active: true, online: true, focusedTask: null,
    onOpenTask: vi.fn(), onOpenInbox: vi.fn(), onListCount: vi.fn(), ...props,
  }
  render(<WorkflowsScreen {...all} />)
  return all
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('WorkflowsScreen', () => {
  it('empty list shows the empty state; count is reported for the badge', () => {
    const p = renderScreen({ list: [], diagram: null, live: null })
    expect(screen.getByText('No running workflows at this work center.')).toBeTruthy()
    expect(p.onListCount).toHaveBeenCalledWith(0)
  })

  it('renders chips and auto-selects; mine dot and status pill present', () => {
    renderScreen({ list: [wf(), wf({ id: 'i2', runtimeNumber: 2, runtimeLabel: 'MIX-20261007-002', masterName: 'Ship', mine: true })] })
    const chips = screen.getAllByRole('option')
    expect(chips[0]!.textContent).toContain('MIX-20261007-001 · Pack v1.0.0')
    expect(chips[0]!.textContent).not.toContain('RW-1')
    expect(chips[0]!.textContent).toContain('running')
    // No focused task, i2 is mine → i2 auto-selected.
    expect(chips[1]!.getAttribute('aria-selected')).toBe('true')
  })

  it('focused task instance wins the default selection', () => {
    renderScreen(
      { list: [wf({ id: 'iX', runtimeNumber: 9, runtimeLabel: 'MIX-20261007-009' }), wf({ id: 'i1', mine: true })] },
      { focusedTask: task({ instanceId: 'iX' }) },
    )
    expect(screen.getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe('true')
  })

  it('tapping a mine step opens the tooltip; Open jumps to the task', () => {
    const p = renderScreen({})
    fireEvent.click(document.querySelector('g[data-step-oid="s1"]')!)
    expect(screen.getByText('Waiting for operator')).toBeTruthy()
    expect(screen.getByText('Yours')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(p.onOpenTask).toHaveBeenCalledWith('a1')
  })

  it('offered-to-me step: Open goes to the inbox', () => {
    const p = renderScreen({
      live: liveWith({
        steps: { s1: { state: 'WAITING_USER', nodeOid: 'rt_0', error: null, assignment: { id: 'a9', status: 'offered', claimant: null, mine: true } } },
      }),
    })
    fireEvent.click(document.querySelector('g[data-step-oid="s1"]')!)
    expect(screen.getByText('Offered to you')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(p.onOpenInbox).toHaveBeenCalled()
  })

  it('proxy tap drills down; breadcrumb returns to the parent', () => {
    renderScreen({})
    fireEvent.click(document.querySelector('g[data-step-oid="sp"]')!)
    expect(document.querySelector('g[data-step-oid="cs1"]')).toBeTruthy()   // child level
    expect(document.querySelector('g[data-step-oid="s1"]')).toBeNull()
    const crumbs = screen.getByRole('navigation', { name: 'Workflow level' })
    fireEvent.click(crumbs.querySelectorAll('button')[0]!)                  // back to root
    expect(document.querySelector('g[data-step-oid="s1"]')).toBeTruthy()
  })

  it('unavailable selection shows the gone message', () => {
    renderScreen({ diagram: null, live: null, unavailable: true })
    expect(screen.getByText('This workflow is no longer available.')).toBeTruthy()
  })

  it('deleted selection recovers: auto-selects the next running workflow instead of parking on the alert', () => {
    // First render: i1 listed and auto-selected.
    vi.mocked(useWorkflowDiagrams).mockReturnValue({
      list: [wf()], diagram: DIAGRAM, live: liveWith(), unavailable: false,
    })
    const props: WorkflowsScreenProps = {
      wcId: 'wc1', active: true, online: true, focusedTask: null,
      onOpenTask: vi.fn(), onOpenInbox: vi.fn(), onListCount: vi.fn(),
    }
    const { rerender } = render(<WorkflowsScreen {...props} />)
    expect(screen.getByRole('option').getAttribute('aria-selected')).toBe('true')

    // i1 is hard-deleted: it 404s (unavailable while selected) and drops off the list,
    // which now carries only i2. The real hook resets unavailable when the selection
    // changes — the mock mirrors that by keying on the selectedId argument.
    vi.mocked(useWorkflowDiagrams).mockImplementation((_wc, _active, _online, selectedId) => ({
      list: [wf({ id: 'i2', runtimeNumber: 2, runtimeLabel: 'MIX-20261007-002', masterName: 'Ship' })],
      diagram: null, live: null, unavailable: selectedId === 'i1',
    }))
    rerender(<WorkflowsScreen {...props} />)

    const chip = screen.getByRole('option')
    expect(chip.textContent).toContain('MIX-20261007-002 · Ship v1.0.0')
    expect(chip.textContent).not.toContain('RW-2')
    expect(chip.getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('This workflow is no longer available.')).toBeNull()
  })

  it('deleted selection with nothing else running clears to the empty state', () => {
    vi.mocked(useWorkflowDiagrams).mockReturnValue({
      list: [wf()], diagram: DIAGRAM, live: liveWith(), unavailable: false,
    })
    const props: WorkflowsScreenProps = {
      wcId: 'wc1', active: true, online: true, focusedTask: null,
      onOpenTask: vi.fn(), onOpenInbox: vi.fn(), onListCount: vi.fn(),
    }
    const { rerender } = render(<WorkflowsScreen {...props} />)

    vi.mocked(useWorkflowDiagrams).mockImplementation((_wc, _active, _online, selectedId) => ({
      list: [], diagram: null, live: null, unavailable: selectedId === 'i1',
    }))
    rerender(<WorkflowsScreen {...props} />)

    expect(screen.getByText('No running workflows at this work center.')).toBeTruthy()
    expect(screen.queryByText('This workflow is no longer available.')).toBeNull()
  })

  it('offline shows the stale line', () => {
    renderScreen({}, { online: false })
    expect(screen.getByText('Offline — showing last known state')).toBeTruthy()
  })

  it('an armed GATE tooltip names the action it controls (GATE follow-up 8c)', () => {
    renderScreen({ live: liveWith({ steps: {
      ...liveWith().steps,
      g1: { state: 'WAITING_GATE', nodeOid: 'rt_0', error: null, assignment: null,
        armedGate: { predecessorOid: 's1', open: true, stopSent: false } },
    } }) })
    fireEvent.click(document.querySelector('g[data-step-oid="g1"]')!)
    expect(screen.getByText('Controls Fill · open, waiting for it to finish')).toBeTruthy()
  })

  it('a new context pane re-selects its runtime, even after an earlier selection', () => {
    vi.mocked(useWorkflowDiagrams).mockReturnValue({
      list: [wf({ id: 'i1' }), wf({ id: 'i2', runtimeNumber: 2, runtimeLabel: 'MIX-20261007-002' })],
      diagram: DIAGRAM, live: liveWith(), unavailable: false,
    })
    const props: WorkflowsScreenProps = {
      wcId: 'wc1', active: true, online: true, focusedTask: task({ assignmentId: 'a1', instanceId: 'i1' }),
      onOpenTask: vi.fn(), onOpenInbox: vi.fn(), onListCount: vi.fn(),
    }
    const { rerender } = render(<WorkflowsScreen {...props} />)
    expect(screen.getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe('true')

    rerender(<WorkflowsScreen {...props} focusedTask={task({ assignmentId: 'a2', instanceId: 'i2' })} />)
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true')
  })

  it('a manual pick survives a refresh of the same context pane', () => {
    vi.mocked(useWorkflowDiagrams).mockReturnValue({
      list: [wf({ id: 'i1' }), wf({ id: 'i2', runtimeNumber: 2, runtimeLabel: 'MIX-20261007-002' })],
      diagram: DIAGRAM, live: liveWith(), unavailable: false,
    })
    const props: WorkflowsScreenProps = {
      wcId: 'wc1', active: true, online: true, focusedTask: task({ assignmentId: 'a1', instanceId: 'i1' }),
      onOpenTask: vi.fn(), onOpenInbox: vi.fn(), onListCount: vi.fn(),
    }
    const { rerender } = render(<WorkflowsScreen {...props} />)
    fireEvent.click(screen.getAllByRole('option')[1]!)
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true')

    // A snapshot refresh hands over a NEW object for the SAME pane.
    rerender(<WorkflowsScreen {...props} focusedTask={task({ assignmentId: 'a1', instanceId: 'i1' })} />)
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true')
  })

  it('pane switches while the tab is hidden select nothing (no background diagram fetch); opening the tab selects the last one', () => {
    // The real hook loads no list until the tab is first shown.
    vi.mocked(useWorkflowDiagrams).mockReturnValue({ list: null, diagram: null, live: null, unavailable: false })
    const props: WorkflowsScreenProps = {
      wcId: 'wc1', active: false, online: true, focusedTask: null,
      onOpenTask: vi.fn(), onOpenInbox: vi.fn(), onListCount: vi.fn(),
    }
    const { rerender } = render(<WorkflowsScreen {...props} />)
    rerender(<WorkflowsScreen {...props} focusedTask={task({ assignmentId: 'a1', instanceId: 'i1' })} />)
    rerender(<WorkflowsScreen {...props} focusedTask={task({ assignmentId: 'a2', instanceId: 'i2' })} />)
    // The 4th argument is the selected instance: the diagram/live fetches key off it.
    expect(vi.mocked(useWorkflowDiagrams).mock.lastCall![3]).toBeNull()

    vi.mocked(useWorkflowDiagrams).mockReturnValue({
      list: [wf({ id: 'i1' }), wf({ id: 'i2', runtimeNumber: 2, runtimeLabel: 'MIX-20261007-002' })],
      diagram: DIAGRAM, live: liveWith(), unavailable: false,
    })

    rerender(<WorkflowsScreen {...props} active focusedTask={task({ assignmentId: 'a2', instanceId: 'i2' })} />)
    expect(vi.mocked(useWorkflowDiagrams).mock.lastCall![3]).toBe('i2')
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true')
  })

  it('the legend swatches use the same state tokens as the diagram', () => {
    vi.mocked(useWorkflowDiagrams).mockReturnValue({ list: [wf({ id: 'i1' })], diagram: DIAGRAM, live: liveWith(), unavailable: false })
    const props: WorkflowsScreenProps = {
      wcId: 'wc1', active: true, online: true, focusedTask: null,
      onOpenTask: vi.fn(), onOpenInbox: vi.fn(), onListCount: vi.fn(),
    }
    const { container } = render(<WorkflowsScreen {...props} />)
    const items = Array.from(container.querySelectorAll('.wf-legend li')) as HTMLElement[]
    expect(items.map((li) => (li.querySelector('.wf-swatch') as HTMLElement).style.background)).toEqual([
      'var(--pilot-state-idle)', 'var(--pilot-state-waiting)', 'var(--pilot-state-gate)', 'var(--pilot-state-executing)',
      'var(--pilot-state-paused)', 'var(--pilot-state-completed)', 'var(--pilot-state-errored)', 'var(--pilot-state-cancelled)',
      '', // "Your task" ring swatch has no fill
    ])
    expect(items.map((li) => li.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      '○ Not started', '◐ Waiting', '◇ Waiting on gate', '▶ Executing',
      '‖ Paused', '✓ Completed', '✕ Errored', '– Cancelled', 'Your task',
    ])
  })
})
