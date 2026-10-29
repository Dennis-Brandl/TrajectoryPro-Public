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
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import type { FormDocumentViewProps } from '@mission/form-renderer'
import type { FormDocument } from '@mission/form-schema'
import { WorkView, type WorkViewProps } from '../WorkView'
import { api, ApiError } from '../../api/client'
import { Toasts } from '../../toast'
import { useSession } from '../../session'
import type { InboxSnapshot, InboxTask } from '../../api/types'
import type { WorkflowsScreenProps } from '../workflows/WorkflowsScreen'
import { instanceStripe } from '../../frame/runtime-id'
import { writeDraft } from '../../task/drafts'

vi.mock('../../session', () => ({ useSession: vi.fn() }))

// WorkView mounts every pane's TaskScreen at once, so a single lastRendererProps
// would only see whichever pane rendered last — capture per document instead,
// keyed by the doc's first field name (every fixture doc uses a distinct one).
const rendererProps = new Map<string, FormDocumentViewProps>()

vi.mock('@mission/form-renderer', () => ({
  FormDocumentView: (props: FormDocumentViewProps) => {
    const d = props.document as FormDocument
    const block = d.sections[0]?.rows?.[0]?.blocks?.[0] as { fieldName?: string } | undefined
    rendererProps.set(block?.fieldName ?? 'unknown', props)
    return <div data-testid={`renderer-${block?.fieldName ?? 'unknown'}`} />
  },
}))

// The Workflows tab's own behaviour is covered by WorkflowsScreen.test.tsx; here we
// only care which pane WorkView hands it as context.
let workflowsProps: WorkflowsScreenProps | undefined
vi.mock('../workflows/WorkflowsScreen', () => ({
  WorkflowsScreen: (props: WorkflowsScreenProps) => {
    workflowsProps = props
    return <div data-testid="workflows-screen" />
  },
}))

vi.mock('../../api/client', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number) {
      super(`HTTP ${status}`)
      this.status = status
    }
  }
  return {
    api: {
      claim: vi.fn(),
      release: vi.fn(),
      submit: vi.fn(),
      // Never resolve: the Workflows tab stays in its loading state, so
      // useWorkflowDiagrams never touches WorkView's own state/effects.
      runtimeWorkflows: vi.fn(() => new Promise(() => {})),
      runtimeDiagram: vi.fn(() => new Promise(() => {})),
      runtimeLiveStates: vi.fn(() => new Promise(() => {})),
    },
    ApiError,
  }
})

function doc(fieldName: string): FormDocument {
  return {
    version: 2,
    sections: [
      {
        id: 's1',
        role: 'content',
        rows: [{ id: 'r1', blocks: [{ id: 'b1', type: 'textInput', fieldName, required: false }] }],
      },
    ],
  }
}

function task(overrides: Partial<InboxTask> = {}): InboxTask {
  return {
    assignmentId: 'a1',
    stepInstanceId: 'si1',
    stepOid: 'so1',
    stepType: 'USER_INTERACTION',
    stepName: 'Step',
    instanceId: 'i1',
    runtimeNumber: 1,
    runtimeLabel: 'MIX-20261007-001',
    masterName: 'Master',
    offeredAt: '2026-08-03T00:00:00.000Z',
    claimedAt: '2026-08-03T00:00:01.000Z',
    suggestedForMe: false,
    paused: false,
    formDocument: null,
    yesNoConfig: null,
    ...overrides,
  }
}

const claimA = task({
  assignmentId: 'a-a',
  stepInstanceId: 'si-a',
  stepName: 'Fit bracket',
  runtimeNumber: 3,
  runtimeLabel: 'MIX-20261007-003',
  claimedAt: '2026-08-03T00:00:01.000Z',
})
const claimB = task({
  assignmentId: 'a-b',
  stepInstanceId: 'si-b',
  stepName: 'Torque check',
  runtimeNumber: 4,
  runtimeLabel: 'MIX-20261007-004',
  claimedAt: '2026-08-03T00:00:02.000Z',
})

function snap(myClaims: InboxTask[], offers: InboxTask[] = []): InboxSnapshot {
  return { workCenterId: 'wc1', myClaims, offers }
}

function renderWork(overrides: Partial<WorkViewProps> = {}) {
  const props: WorkViewProps = {
    wcId: 'wc1',
    wcName: 'Mixing Line 2',
    snapshot: null,
    stale: false,
    inboxOffline: false,
    offline: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  const view = render(
    <>
      <Toasts />
      <WorkView {...props} />
    </>,
  )
  const update = (next: Partial<WorkViewProps>) => {
    Object.assign(props, next)
    view.rerender(
      <>
        <Toasts />
        <WorkView {...props} />
      </>,
    )
  }
  return { props, update, container: view.container }
}

function selectedTab(): string {
  return screen.getByRole('tab', { selected: true }).textContent ?? ''
}

describe('WorkView', () => {
  beforeEach(() => {
    workflowsProps = undefined
    vi.clearAllMocks()
    rendererProps.clear()
    vi.mocked(useSession).mockReturnValue({
      user: { id: 'u1', email: 'jane@example.com', displayName: 'Jane Operator', loginName: 'jane.op' },
      ready: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
    })
  })

  afterEach(cleanup)

  it('with no claims, shows the inbox with the fixed Inbox+Workflows strip', () => {
    renderWork({ snapshot: snap([], [task({ assignmentId: 'o1', claimedAt: null })]) })

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Inbox (1)', 'Workflows'])
    expect(screen.getByRole('heading', { name: 'My tasks' })).toBeTruthy()
  })

  it('claims render as tabs after the Inbox tab, in claimedAt order, with the offer count on Inbox', () => {
    renderWork({ snapshot: snap([claimB, claimA], [task({ assignmentId: 'o1', claimedAt: null })]) })

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.getAttribute('aria-label') ?? t.textContent)).toEqual([
      'Inbox (1)',
      'Workflows',
      'Fit bracket · MIX-20261007-003 · Master',
      'Torque check · MIX-20261007-004 · Master',
    ])
    expect(selectedTab()).toBe('Inbox (1)')
  })

  it('clicking a tab shows that pane and hides the inbox; clicking Inbox returns', () => {
    renderWork({ snapshot: snap([claimA, claimB]) })

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))

    expect(selectedTab()).toContain('Fit bracket')
    expect(screen.getByRole('heading', { name: 'Fit bracket' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'My tasks' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Torque check' })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /Inbox/ }))
    expect(screen.getByRole('heading', { name: 'My tasks' })).toBeTruthy()
  })

  it('the arrow buttons walk inbox → panes and clamp at the ends', () => {
    renderWork({ snapshot: snap([claimA, claimB]) })
    const prev = screen.getByRole('button', { name: 'Previous tab' }) as HTMLButtonElement
    const next = screen.getByRole('button', { name: 'Next tab' }) as HTMLButtonElement

    expect(prev.disabled).toBe(true)
    fireEvent.click(next)
    expect(selectedTab()).toBe('Workflows')
    fireEvent.click(next)
    expect(selectedTab()).toContain('Fit bracket')
    fireEvent.click(next)
    expect(selectedTab()).toContain('Torque check')
    expect(next.disabled).toBe(true)
    fireEvent.click(prev)
    expect(selectedTab()).toContain('Fit bracket')
  })

  it('a paused claim shows a Paused badge on its tab and a locked pane', () => {
    renderWork({ snapshot: snap([{ ...claimA, paused: true }]) })

    expect(within(screen.getByRole('tab', { name: /Fit bracket/ })).getByText('Paused')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('typed values survive switching tabs (panes stay mounted)', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    const formA = { ...claimA, formDocument: doc('serial') }
    const formB = { ...claimB, formDocument: doc('torque') }
    renderWork({ snapshot: snap([formA, formB]) })

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    act(() => {
      rendererProps.get('serial')!.onEvent!({ kind: 'fieldChange', fieldName: 'serial', value: 'SN-042' })
    })

    fireEvent.click(screen.getByRole('tab', { name: /Torque check/ }))
    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(api.submit).toHaveBeenCalledWith('a-a', { kind: 'submit', values: { serial: 'SN-042' } }),
    )
  })

  it('submit closes the pane and focuses the next tab', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    const { props } = renderWork({ snapshot: snap([claimA, claimB]) })

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(screen.queryByRole('tab', { name: /Fit bracket/ })).toBeNull())
    expect(selectedTab()).toContain('Torque check')
    expect(screen.getByRole('heading', { name: 'Torque check' })).toBeTruthy()
    expect(props.refresh).toHaveBeenCalled()
    expect(screen.getByText('Submitted Fit bracket · MIX-20261007-003').className).toBe('toast toast-ok')
    // Spec §5.6: focus goes to the next pane's heading, never into its form, with a cue.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Torque check' })))
    expect(document.querySelector('#panel-a-b .task-arrival')!.textContent).toBe('Now on: Torque check · MIX-20261007-004')
    expect(document.querySelector('.context-bar')!.classList.contains('context-bar-arrived')).toBe(true)
  })

  it('submitting the only claim returns to the inbox and removes the tab strip', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    renderWork({ snapshot: snap([claimA]) })

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeTruthy()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'My tasks' })))
  })

  it('a submit that loses the race (409) toasts, closes the pane, and moves on', async () => {
    vi.mocked(api.submit).mockRejectedValue(new ApiError(409))
    renderWork({ snapshot: snap([claimA, claimB]) })

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('This task changed — refreshing.')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /Fit bracket/ })).toBeNull()
    expect(selectedTab()).toContain('Torque check')
  })

  it('a transient submit failure toasts and keeps the pane focused', async () => {
    vi.mocked(api.submit).mockRejectedValue(new TypeError('Failed to fetch'))
    renderWork({ snapshot: snap([claimA]) })

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Something went wrong — try again.')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Fit bracket/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('a lost race never shows the submit confirmation', async () => {
    vi.mocked(api.submit).mockRejectedValue(new ApiError(409))
    renderWork({ snapshot: snap([claimA, claimB]) })

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await screen.findByText('This task changed — refreshing.')
    expect(screen.queryByText(/^Submitted /)).toBeNull()
  })

  it('claiming an offer focuses its pane once the snapshot lists it (inbox shown in the gap)', async () => {
    vi.mocked(api.claim).mockResolvedValue(undefined)
    const offer = task({ assignmentId: 'a-new', stepInstanceId: 'si-new', stepName: 'New step', claimedAt: null })
    const { update } = renderWork({ snapshot: snap([], [offer]) })

    fireEvent.click(screen.getByRole('button', { name: 'Claim' }))

    await waitFor(() => expect(api.claim).toHaveBeenCalledWith('a-new'))
    // snapshot prop has not caught up yet: the view falls back to the inbox
    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeTruthy()

    update({ snapshot: snap([{ ...offer, claimedAt: '2026-08-03T00:00:05.000Z' }], []) })

    await waitFor(() => expect(selectedTab()).toContain('New step'))
    expect(screen.getByRole('heading', { name: 'New step' })).toBeTruthy()
  })

  it('threads offline flags: inbox buttons disable on inboxOffline, task actions on offline', () => {
    renderWork({
      snapshot: snap([claimA], [task({ assignmentId: 'o1', claimedAt: null })]),
      inboxOffline: true,
      offline: true,
    })

    expect((screen.getByRole('button', { name: 'Claim' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('the first fresh snapshot never steals focus (claims restored on login stay background tabs)', () => {
    renderWork({ snapshot: snap([claimA]) })
    expect(selectedTab()).toContain('Inbox')
  })

  it('a pane arriving while the inbox is focused auto-focuses (the auto-claim chain hand-off)', () => {
    const { update } = renderWork({ snapshot: snap([]) })
    update({ snapshot: snap([claimA]) })

    expect(selectedTab()).toContain('Fit bracket')
    expect(screen.getByRole('heading', { name: 'Fit bracket' })).toBeTruthy()
  })

  it('a pane arriving while another pane is focused does not steal focus', () => {
    const { update } = renderWork({ snapshot: snap([claimA]) })
    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    update({ snapshot: snap([claimA, claimB]) })

    expect(selectedTab()).toContain('Fit bracket')
    expect(screen.getByRole('tab', { name: /Torque check/ })).toBeTruthy()
  })

  it('stale (cached) snapshots render tabs but never toast or move focus', () => {
    const { update } = renderWork({ snapshot: snap([claimA]), stale: true })
    update({ snapshot: snap([claimA, claimB]), stale: false })

    expect(selectedTab()).toContain('Inbox')
    expect(screen.queryByText(/No longer yours/)).toBeNull()
  })

  it('an externally removed background pane toasts and drops its tab, keeping focus', () => {
    const { update } = renderWork({ snapshot: snap([claimA, claimB]) })
    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    update({ snapshot: snap([claimA]) })

    expect(screen.getByText('No longer yours: Torque check · MIX-20261007-004')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /Torque check/ })).toBeNull()
    expect(selectedTab()).toContain('Fit bracket')
  })

  it('an externally removed focused pane hands focus to the next surviving tab', () => {
    const claimC = task({
      assignmentId: 'a-c',
      stepInstanceId: 'si-c',
      stepName: 'Final check',
      runtimeNumber: 5,
      claimedAt: '2026-08-03T00:00:03.000Z',
    })
    const { update } = renderWork({ snapshot: snap([claimA, claimB, claimC]) })
    fireEvent.click(screen.getByRole('tab', { name: /Torque check/ }))
    update({ snapshot: snap([claimA, claimC]) })

    expect(screen.getByText('No longer yours: Torque check · MIX-20261007-004')).toBeTruthy()
    expect(selectedTab()).toContain('Final check')
  })

  it('releasing your own claim from the inbox retires its tab immediately and never toasts "No longer yours"', async () => {
    vi.mocked(api.release).mockResolvedValue(undefined)
    const { update } = renderWork({ snapshot: snap([claimA, claimB]) })

    // "Torque check" also appears in claimB's hidden TaskScreen header and its claim tab,
    // so scope to the inbox panel's row (no offers in this snapshot to collide with).
    fireEvent.click(
      within(within(document.getElementById('panel-inbox')!).getByText('Torque check', { selector: '.inbox-open' }).closest('li')!).getByRole('button', {
        name: 'Release',
      }),
    )

    // Tombstoned the instant the release resolves — before any new snapshot arrives.
    await waitFor(() => expect(screen.queryByRole('tab', { name: /Torque check/ })).toBeNull())

    update({ snapshot: snap([claimA]) })

    expect(screen.queryByText(/No longer yours/)).toBeNull()
  })

  it('a locally submitted pane leaving the snapshot never toasts', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    const { update } = renderWork({ snapshot: snap([claimA]) })

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'My tasks' })

    update({ snapshot: snap([]) })

    expect(screen.queryByText(/No longer yours/)).toBeNull()
  })

  it('a submit rejected because the step paused resurfaces the tab as paused (tombstone released)', async () => {
    vi.mocked(api.submit).mockRejectedValue(new ApiError(409))
    const { update } = renderWork({ snapshot: snap([claimA]) })

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('This task changed — refreshing.')
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    update({ snapshot: snap([{ ...claimA, paused: true }]) })

    expect(within(screen.getByRole('tab', { name: /Fit bracket/ })).getByText('Paused')).toBeTruthy()
    expect(screen.queryByText(/No longer yours/)).toBeNull()

    // The next poll repeats the same content (a fresh snapshot object, same values):
    // the resurfaced pane must not be re-diffed as "just arrived" and steal focus.
    update({ snapshot: snap([{ ...claimA, paused: true }]) })
    expect(selectedTab()).toContain('Inbox')

    // A genuine external removal after the resurrect must still toast.
    update({ snapshot: snap([]) })
    expect(screen.getByText('No longer yours: Fit bracket · MIX-20261007-003')).toBeTruthy()
  })

  it('horizontal swipes move between inbox and panes; vertical scrolls do not', () => {
    const { container } = renderWork({ snapshot: snap([claimA, claimB]) })
    const surface = container.querySelector('.work-panes')!

    fireEvent.touchStart(surface, { touches: [{ clientX: 300, clientY: 100 }] })
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 120, clientY: 110 }] })
    expect(selectedTab()).toBe('Workflows')

    fireEvent.touchStart(surface, { touches: [{ clientX: 300, clientY: 100 }] })
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 120, clientY: 110 }] })
    expect(selectedTab()).toContain('Fit bracket')

    fireEvent.touchStart(surface, { touches: [{ clientX: 120, clientY: 100 }] })
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 300, clientY: 90 }] })
    expect(selectedTab()).toBe('Workflows')

    fireEvent.touchStart(surface, { touches: [{ clientX: 120, clientY: 100 }] })
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 300, clientY: 90 }] })
    expect(selectedTab()).toContain('Inbox')

    // vertical-dominant drag (a list scroll): no tab change
    fireEvent.touchStart(surface, { touches: [{ clientX: 300, clientY: 100 }] })
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 240, clientY: 400 }] })
    expect(selectedTab()).toContain('Inbox')

    // short horizontal flick (|dx| = 40 < 48, decisively horizontal): no tab change
    fireEvent.touchStart(surface, { touches: [{ clientX: 300, clientY: 100 }] })
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 260, clientY: 105 }] })
    expect(selectedTab()).toContain('Inbox')
  })

  it('arrow keys on the tablist move the selection', () => {
    renderWork({ snapshot: snap([claimA]) })

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })
    expect(selectedTab()).toBe('Workflows')

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })
    expect(selectedTab()).toContain('Fit bracket')

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' })
    expect(selectedTab()).toBe('Workflows')

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' })
    expect(selectedTab()).toContain('Inbox')
  })

  it('the Workflows tab shows its panel, hides the inbox, and keeps panes mounted', () => {
    renderWork({ snapshot: snap([claimA]) })
    fireEvent.click(screen.getByRole('tab', { name: 'Workflows' }))
    expect(selectedTab()).toBe('Workflows')
    expect(screen.queryByRole('heading', { name: 'My tasks' })).toBeNull()
    // The inbox panel is hidden, not unmounted.
    expect(document.getElementById('panel-inbox')!.hidden).toBe(true)
    expect(document.getElementById('panel-workflows')!.hidden).toBe(false)
  })

  it('an externally removed pane never moves focus off the Workflows tab', async () => {
    const { update } = renderWork({ snapshot: snap([claimA]) })
    fireEvent.click(screen.getByRole('tab', { name: 'Workflows' }))
    update({ snapshot: snap([]) }) // force-release elsewhere
    await screen.findByText('No longer yours: Fit bracket · MIX-20261007-003')
    expect(selectedTab()).toBe('Workflows')
  })

  it('the browser tab title follows the focused tab', () => {
    renderWork({ snapshot: snap([claimA]) })
    expect(document.title).toBe('Inbox — Mission Pilot')

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    expect(document.title).toBe('Fit bracket · MIX-20261007-003 — Mission Pilot')

    fireEvent.click(screen.getByRole('tab', { name: 'Workflows' }))
    expect(document.title).toBe('Workflows — Mission Pilot')
  })

  it('leaving the work view (sign-out, work-center switch) restores the plain title', () => {
    renderWork({ snapshot: snap([claimA]) })
    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    cleanup()
    expect(document.title).toBe('Mission Pilot')
  })

  it('the Workflows tab gets the pane the operator just left as its context', () => {
    renderWork({ snapshot: snap([claimA, claimB]) })

    fireEvent.click(screen.getByRole('tab', { name: /Torque check/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Workflows' }))
    expect(workflowsProps!.focusedTask?.assignmentId).toBe('a-b')

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Workflows' }))
    expect(workflowsProps!.focusedTask?.assignmentId).toBe('a-a')
  })

  it('from the inbox, the Workflows tab keeps the last pane; a closed pane gives no context', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    renderWork({ snapshot: snap([claimA]) })

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('tab', { name: /Inbox/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Workflows' }))
    expect(workflowsProps!.focusedTask?.assignmentId).toBe('a-a')

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'My tasks' })
    expect(workflowsProps!.focusedTask).toBeNull()
  })

  it('a claim tab: step on line 1, runtime ID (last segment whole) · workflow on line 2, a per-runtime stripe', () => {
    renderWork({ snapshot: snap([claimA]) })
    const tab = screen.getByRole('tab', { name: /Fit bracket/ })

    expect(tab.getAttribute('aria-label')).toBe('Fit bracket · MIX-20261007-003 · Master')
    expect(tab.querySelector('.claim-tab-step')!.textContent).toBe('Fit bracket')
    expect(tab.querySelector('.claim-tab-meta')!.textContent).toBe('MIX-20261007-003 · Master')
    expect(tab.querySelector('.elide-tail')!.textContent).toBe('003')
    // P1b minor: a leading space at the start of a flex item collapses, so the separator
    // is its own element with preserved spaces ("003 · Master", not "003· Master").
    expect(tab.querySelector('.claim-tab-wf .sep')!.textContent).toBe(' · ')
    expect(tab.style.getPropertyValue('--tab-stripe')).toBe(`var(--pilot-instance-${instanceStripe('MIX-20261007-003')})`)
  })

  it('"N open" lists every claim with its paused state and jumps to the one picked', () => {
    renderWork({ snapshot: snap([claimA, { ...claimB, paused: true }]) })

    fireEvent.click(screen.getByRole('button', { name: '2 open' }))
    const sheet = screen.getByRole('dialog', { name: 'Open tasks' })
    expect(within(sheet).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Fit bracketMIX-20261007-003 · Master',
      'Torque checkMIX-20261007-004 · MasterPaused',
    ])

    fireEvent.click(within(sheet).getByRole('button', { name: /Torque check/ }))
    expect(selectedTab()).toContain('Torque check')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('with no claims there is no "N open" button', () => {
    renderWork({ snapshot: snap([]) })
    expect(screen.queryByRole('button', { name: /open$/ })).toBeNull()
  })

  it('a focused task pane gets the context bar; the inbox and Workflows tabs do not', () => {
    const { container } = renderWork({ snapshot: snap([claimA]) })
    expect(container.querySelector('.context-bar')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    const bar = container.querySelector('.context-bar')!
    expect(bar.textContent).toContain('Fit bracket')
    expect(bar.textContent).toContain('MIX-20261007-003')
    expect(bar.textContent).toContain('Mixing Line 2')

    fireEvent.click(screen.getByRole('tab', { name: 'Workflows' }))
    expect(container.querySelector('.context-bar')).toBeNull()
  })

  it('Release from the task footer closes the pane, moves on and says so', async () => {
    vi.mocked(api.release).mockResolvedValue(undefined)
    renderWork({ snapshot: snap([claimA, claimB]) })

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(within(document.getElementById('panel-a-a')!).getByRole('button', { name: 'Release' }))

    await waitFor(() => expect(screen.queryByRole('tab', { name: /Fit bracket/ })).toBeNull())
    expect(api.release).toHaveBeenCalledWith('a-a')
    expect(selectedTab()).toContain('Torque check')
    expect(screen.getByText('Released Fit bracket · MIX-20261007-003')).toBeTruthy()
  })

  it('the "Now on" cue ends at the first click or key in that pane — never on pointer-down', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    renderWork({ snapshot: snap([claimA, claimB]) })
    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Now on:', { exact: false })

    // P1d Task 1 (e2e baseline): removing the banner on pointer-down moved everything below
    // it up before the pointer came back up, so the click landed on another element and the
    // operator's first Continue/Approve on an arrived pane was silently lost.
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Torque check' }))
    expect(document.querySelector('.task-arrival')).not.toBeNull()

    fireEvent.click(screen.getByRole('heading', { name: 'Torque check' }))

    expect(document.querySelector('.task-arrival')).toBeNull()
    expect(document.querySelector('.context-bar')!.classList.contains('context-bar-arrived')).toBe(false)
  })

  it('a follow-on step for the same runtime that arrives right after Submit takes focus (spec §5.6 item 4)', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    const b = { ...claimB, instanceId: 'i2' }
    const { update } = renderWork({ snapshot: snap([claimA, b]) })
    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(selectedTab()).toContain('Torque check'))

    const next = task({
      assignmentId: 'a-c',
      stepInstanceId: 'si-c',
      stepName: 'Seal lid',
      runtimeLabel: 'MIX-20261007-003',
      instanceId: 'i1',
      claimedAt: '2026-08-03T00:00:03.000Z',
    })
    update({ snapshot: snap([b, next]) })

    await waitFor(() => expect(selectedTab()).toContain('Seal lid'))
    expect(document.querySelector('#panel-a-c .task-arrival')!.textContent).toBe('Now on: Seal lid · MIX-20261007-003')
  })

  it('a new claim from another runtime does not take focus from the next tab', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    const b = { ...claimB, instanceId: 'i2' }
    const { update } = renderWork({ snapshot: snap([claimA, b]) })
    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(selectedTab()).toContain('Torque check'))

    const other = task({ assignmentId: 'a-c', stepInstanceId: 'si-c', stepName: 'Seal lid', instanceId: 'i9', claimedAt: '2026-08-03T00:00:03.000Z' })
    update({ snapshot: snap([b, other]) })

    await screen.findByRole('tab', { name: /Seal lid/ })
    expect(selectedTab()).toContain('Torque check')
  })

  it('a closed pane stops being the Workflows tab context, even if it comes back (P0)', async () => {
    vi.mocked(api.submit).mockRejectedValue(new ApiError(409))
    const { update } = renderWork({ snapshot: snap([claimA]) })
    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('This task changed — refreshing.')

    // The 409 was a pause landing mid-submit: the claim comes back, paused.
    update({ snapshot: snap([{ ...claimA, paused: true }]) })
    await screen.findByRole('tab', { name: /Fit bracket/ })
    fireEvent.click(screen.getByRole('tab', { name: 'Workflows' }))

    expect(workflowsProps!.focusedTask).toBeNull()
  })

  it('a claim taken away externally drops its saved draft', async () => {
    sessionStorage.setItem('pilot:draft:a-b', JSON.stringify({ stepInstanceId: 'si-b', values: { torque: '12' } }))
    const { update } = renderWork({ snapshot: snap([claimA, claimB]) })

    update({ snapshot: snap([claimA]) })

    await screen.findByText('No longer yours: Torque check · MIX-20261007-004')
    expect(sessionStorage.getItem('pilot:draft:a-b')).toBeNull()
  })

  it('only the pane on screen loads its "Where you are" steps', async () => {
    renderWork({ snapshot: snap([claimA, { ...claimB, instanceId: 'i2' }]) })
    expect(api.runtimeLiveStates).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))

    await waitFor(() => expect(api.runtimeLiveStates).toHaveBeenCalledWith('i1'))
    expect(api.runtimeLiveStates).not.toHaveBeenCalledWith('i2')
  })

  it('a snapshot still from the previous work center is never diffed: switching keeps every draft and says nothing (final review)', async () => {
    sessionStorage.setItem('pilot:draft:a-a', JSON.stringify({ stepInstanceId: 'si-a', values: { serial: 'SN-1' } }))
    // App remounts WorkView for the new work center while useInbox still holds the old one's fresh snapshot.
    const { update } = renderWork({ wcId: 'wc2', snapshot: snap([claimA]) })

    update({ snapshot: { workCenterId: 'wc2', myClaims: [], offers: [] } })
    await act(async () => {})

    expect(screen.queryByText(/No longer yours/)).toBeNull()
    expect(sessionStorage.getItem('pilot:draft:a-a')).not.toBeNull()
  })

  it('resolves the form surface once and hands it to every pane', () => {
    const real = window.getComputedStyle
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = real(el, pseudo)
      return (el as HTMLElement).style?.color === 'var(--form-color-surface)'
        ? ({ ...style, color: 'rgb(255, 255, 255)' } as CSSStyleDeclaration)
        : style
    })
    renderWork({
      snapshot: snap([
        { ...claimA, formDocument: doc('fa') },
        { ...claimB, formDocument: doc('fb') },
      ]),
    })
    expect(rendererProps.get('fa')!.surfaceColor).toBe('rgb(255, 255, 255)')
    expect(rendererProps.get('fb')!.surfaceColor).toBe('rgb(255, 255, 255)')
    spy.mockRestore()
  })

  const alt = (digit: number) => fireEvent.keyDown(document.body, { key: String(digit), code: `Digit${digit}`, altKey: true })

  it('Alt+1..9 open claim tabs in strip order, Alt+0 the inbox; a missing claim does nothing (P4-R1)', () => {
    renderWork({ snapshot: snap([claimA, claimB]) })
    alt(2)
    expect(selectedTab()).toContain('Torque check')
    alt(1)
    expect(selectedTab()).toContain('Fit bracket')
    alt(5)
    expect(selectedTab()).toContain('Fit bracket')
    alt(0)
    expect(selectedTab()).toBe('Inbox')
  })

  it('/ jumps to the inbox and focuses its filter (P4-R4)', () => {
    renderWork({ snapshot: snap([claimA]) })
    fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
    fireEvent.keyDown(document.body, { key: '/', code: 'Slash' })
    expect(selectedTab()).toBe('Inbox')
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Filter by step, workflow or runtime ID' }))
  })

  it('? lists the shortcuts in a sheet; typed into the filter it is just a character', () => {
    renderWork({ snapshot: snap([claimA]) })
    const filter = screen.getByRole('searchbox', { name: 'Filter by step, workflow or runtime ID' })
    fireEvent.keyDown(filter, { key: '?', shiftKey: true })
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()

    fireEvent.keyDown(document.body, { key: '?', shiftKey: true })
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(within(sheet).getByText('Ctrl+Enter')).toBeTruthy()
    expect(within(sheet).getByText('Copy the runtime ID')).toBeTruthy()
    // A modal owns the keyboard: Alt+1 does nothing under it.
    alt(1)
    expect(selectedTab()).toBe('Inbox')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
  })

  it('Ctrl+Enter submits only the pane on screen', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    renderWork({ snapshot: snap([claimA, claimB]) })
    fireEvent.click(screen.getByRole('tab', { name: /Torque check/ }))
    fireEvent.keyDown(document.body, { key: 'Enter', code: 'Enter', ctrlKey: true })
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1))
    expect(api.submit).toHaveBeenCalledWith('a-b', { kind: 'complete' })
  })

  function wide(matches: boolean) {
    window.matchMedia = vi.fn(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
  }

  describe('Workstation layout (spec §16, P4-R6)', () => {
    afterEach(() => {
      delete (window as { matchMedia?: unknown }).matchMedia
    })

    it('at 1280 px and wider the inbox stays beside the open task', () => {
      wide(true)
      renderWork({ layout: 'workstation', snapshot: snap([claimA]) })
      const rail = screen.getByRole('complementary', { name: 'Inbox' })
      expect(within(rail).getByRole('heading', { name: 'My tasks' })).toBeTruthy()
      fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
      expect(screen.getByRole('heading', { name: 'Fit bracket' })).toBeTruthy()
      expect(within(rail).getByRole('heading', { name: 'My tasks' })).toBeTruthy()
      // One inbox, not two: ids stay unique (inbox-heading is the post-Submit focus target).
      expect(screen.getAllByRole('heading', { name: 'My tasks' })).toHaveLength(1)
    })

    it('the Inbox tab stays in the strip and says where the inbox went', () => {
      wide(true)
      renderWork({ layout: 'workstation', snapshot: snap([claimA]) })
      expect(selectedTab()).toBe('Inbox')
      expect(screen.getByText('Your inbox is in the left column. Open a task there to work on it here.')).toBeTruthy()
    })

    it('below 1280 px Workstation is exactly Standard', () => {
      wide(false)
      renderWork({ layout: 'workstation', snapshot: snap([claimA]) })
      expect(screen.queryByRole('complementary', { name: 'Inbox' })).toBeNull()
      expect(screen.getByRole('heading', { name: 'My tasks' })).toBeTruthy()
    })

    it('Standard never splits, however wide', () => {
      wide(true)
      renderWork({ snapshot: snap([claimA]) })
      expect(screen.queryByRole('complementary', { name: 'Inbox' })).toBeNull()
    })

    it('/ focuses the rail filter without leaving the open task', () => {
      wide(true)
      renderWork({ layout: 'workstation', snapshot: snap([claimA]) })
      fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
      fireEvent.keyDown(document.body, { key: '/', code: 'Slash' })
      expect(selectedTab()).toContain('Fit bracket')
      expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Filter by step, workflow or runtime ID' }))
    })

    it('claiming from the rail opens the task beside it', async () => {
      wide(true)
      vi.mocked(api.claim).mockResolvedValue(undefined)
      const offer = task({ assignmentId: 'o1', stepInstanceId: 'si-o', stepName: 'Weigh', claimedAt: null })
      const { update, props } = renderWork({ layout: 'workstation', snapshot: snap([], [offer]) })
      vi.mocked(props.refresh).mockImplementation(async () => {
        update({ snapshot: snap([{ ...offer, claimedAt: '2026-08-03T00:00:05.000Z' }]) })
      })
      fireEvent.click(within(screen.getByRole('complementary', { name: 'Inbox' })).getByRole('button', { name: 'Claim' }))
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Weigh' })).toBeTruthy())
    })

    // matchMedia whose answer the test can flip, firing the change listeners like a resize.
    function wideLive(initial: boolean) {
      let matches = initial
      const listeners = new Set<() => void>()
      window.matchMedia = vi.fn(() => ({
        get matches() {
          return matches
        },
        addEventListener: (_: string, l: () => void) => listeners.add(l),
        removeEventListener: (_: string, l: () => void) => listeners.delete(l),
      })) as unknown as typeof window.matchMedia
      return (next: boolean) => {
        matches = next
        act(() => listeners.forEach((l) => l()))
      }
    }

    const railRow = (rail: HTMLElement, step: string) =>
      within(rail).getAllByRole('listitem').find((li) => li.textContent?.includes(step))!

    it('Ctrl+Enter from the inbox column (its filter, or a Release question there) never submits the open task', () => {
      wide(true)
      writeDraft('a-b', 'si-b', { reason: 'typed' })
      renderWork({ layout: 'workstation', snapshot: snap([claimA, claimB]) })
      fireEvent.click(screen.getByRole('tab', { name: /Fit bracket/ }))
      const rail = screen.getByRole('complementary', { name: 'Inbox' })
      const filter = within(rail).getByRole('searchbox', { name: 'Filter by step, workflow or runtime ID' })
      filter.focus()
      fireEvent.keyDown(filter, { key: 'Enter', code: 'Enter', ctrlKey: true })
      fireEvent.click(within(railRow(rail, 'Torque check')).getByRole('button', { name: 'Release' }))
      expect(within(rail).getByRole('group', { name: 'Confirm release' })).toBeTruthy()
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Enter', code: 'Enter', ctrlKey: true })
      fireEvent.keyDown(document.body, { key: 'Enter', code: 'Enter', ctrlKey: true })
      expect(api.submit).not.toHaveBeenCalled()
    })

    it('switching layout (or crossing 1280 px) keeps the typed filter and an open Release question', () => {
      const setWide = wideLive(true)
      writeDraft('a-a', 'si-a', { reason: 'typed' })
      renderWork({ layout: 'workstation', snapshot: snap([claimA]) })
      const rail = screen.getByRole('complementary', { name: 'Inbox' })
      fireEvent.change(within(rail).getByRole('searchbox', { name: 'Filter by step, workflow or runtime ID' }), { target: { value: 'Fit' } })
      fireEvent.click(within(railRow(rail, 'Fit bracket')).getByRole('button', { name: 'Release' }))
      setWide(false)
      expect(screen.queryByRole('complementary', { name: 'Inbox' })).toBeNull()
      expect((screen.getByRole('searchbox', { name: 'Filter by step, workflow or runtime ID' }) as HTMLInputElement).value).toBe('Fit')
      expect(screen.getByRole('group', { name: 'Confirm release' })).toBeTruthy()
    })

    it('the inbox column is not a second <main> nested in the <aside>', () => {
      wide(true)
      renderWork({ layout: 'workstation', snapshot: snap([claimA]) })
      expect(within(screen.getByRole('complementary', { name: 'Inbox' })).queryByRole('main')).toBeNull()
    })

    it('opening a task from the inbox column, then Ctrl+Enter, submits it (focus on the row button is not "in the filter")', async () => {
      wide(true)
      vi.mocked(api.submit).mockResolvedValue(undefined)
      renderWork({ layout: 'workstation', snapshot: snap([claimA]) })
      const rail = screen.getByRole('complementary', { name: 'Inbox' })
      const open = within(rail).getByRole('button', { name: 'Fit bracket' })
      open.focus()
      fireEvent.click(open)
      fireEvent.keyDown(open, { key: 'Enter', code: 'Enter', ctrlKey: true })
      await waitFor(() => expect(api.submit).toHaveBeenCalledWith('a-a', { kind: 'complete' }))
    })

    it('typing in the filter that hides and re-shows a row with an open Release question never moves focus to Keep', () => {
      wide(true)
      writeDraft('a-a', 'si-a', { reason: 'typed' })
      renderWork({ layout: 'workstation', snapshot: snap([claimA]) })
      const rail = screen.getByRole('complementary', { name: 'Inbox' })
      fireEvent.click(within(railRow(rail, 'Fit bracket')).getByRole('button', { name: 'Release' }))
      const filter = within(rail).getByRole('searchbox', { name: 'Filter by step, workflow or runtime ID' }) as HTMLInputElement
      filter.focus()
      fireEvent.change(filter, { target: { value: 'zzz' } })
      fireEvent.change(filter, { target: { value: '' } })
      expect(within(rail).getByRole('group', { name: 'Confirm release' })).toBeTruthy()
      expect(document.activeElement).toBe(filter)
    })

    it('a Release question whose claim went away does not come back when the task is claimed again', () => {
      wide(true)
      writeDraft('a-a', 'si-a', { reason: 'typed' })
      const { update } = renderWork({ layout: 'workstation', snapshot: snap([claimA]) })
      const rail = () => screen.getByRole('complementary', { name: 'Inbox' })
      fireEvent.click(within(railRow(rail(), 'Fit bracket')).getByRole('button', { name: 'Release' }))
      update({ snapshot: snap([]) })
      update({ snapshot: snap([claimA]) })
      expect(within(rail()).queryByRole('group', { name: 'Confirm release' })).toBeNull()
    })
  })
})
