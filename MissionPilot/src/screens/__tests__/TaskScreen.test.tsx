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
import { useState as useMockState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react'
import type { FormDocumentViewProps } from '@mission/form-renderer'
import type { FormDocument } from '@mission/form-schema'
import { TaskScreen } from '../TaskScreen'
import { api, ApiError } from '../../api/client'
import type { InboxTask } from '../../api/types'

let lastRendererProps: FormDocumentViewProps | undefined
// Incremented exactly once per NEW renderer instance: a useState lazy initializer
// runs only on that instance's first render (mount), never again on a later
// re-render of the SAME instance — the standard mount-vs-update tell. This pins
// `key={task.stepInstanceId}` on FormDocumentView: deleting the key would still
// pass every other test, but would collapse this counter to 1.
let rendererMountCount = 0

vi.mock('@mission/form-renderer', () => ({
  FormDocumentView: (props: FormDocumentViewProps) => {
    lastRendererProps = props
    useMockState(() => {
      rendererMountCount += 1
      return null
    })
    const doc = props.document as FormDocument
    return (
      <div data-testid="renderer">
        {doc.sections.flatMap((s) =>
          s.rows.flatMap((r) =>
            r.blocks.map((b) => (
              <div key={b.id} data-block-id={b.id}>
                {'fieldName' in b ? <input aria-label={`field ${b.fieldName}`} /> : null}
                {b.type === 'button' ? (
                  <button
                    type="button"
                    onClick={() =>
                      props.onEvent?.(
                        b.job
                          ? { kind: 'job', blockId: b.id, job: b.job }
                          : { kind: 'action', blockId: b.id, outputValue: b.outputValue },
                      )
                    }
                  >
                    {`job ${b.job ?? 'none'}`}
                  </button>
                ) : null}
              </div>
            )),
          ),
        )}
      </div>
    )
  },
}))

vi.mock('../../api/client', () => {
  class ApiError extends Error {
    status: number
    code?: string
    constructor(status: number, code?: string, message?: string) {
      super(message ?? `HTTP ${status}`)
      this.status = status
      this.code = code
    }
  }
  return {
    api: { submit: vi.fn(), release: vi.fn() },
    ApiError,
  }
})

const REQUIRED_NAME_DOC: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's1',
      role: 'content',
      rows: [
        {
          id: 'r1',
          blocks: [{ id: 'b1', type: 'textInput', fieldName: 'name', required: true }],
        },
      ],
    },
  ],
}

const ESIG_DOC: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's1',
      role: 'content',
      rows: [{ id: 'r1', blocks: [{ id: 'e1', type: 'esignature', fieldName: 'approval', label: 'Approve', roleName: 'QA Lead' }] }],
    },
  ],
}
const ESIG_DIFFERENT_USER_DOC: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's1',
      role: 'content',
      rows: [{ id: 'r1', blocks: [{ id: 'e1', type: 'esignature', fieldName: 'approval', requireDifferentUser: true }] }],
    },
  ],
}
const ME = { loginName: 'jane.op', displayName: 'Jane Operator' }
const LABELLED_DOC: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's1',
      role: 'content',
      rows: [{ id: 'r1', blocks: [{ id: 'b1', type: 'textInput', fieldName: 'name', label: 'Operator name', required: true }] }],
    },
  ],
}
const TIMER_DOC: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's1',
      role: 'content',
      rows: [
        {
          id: 'r1',
          blocks: [
            { id: 'b1', type: 'textInput', fieldName: 'name', label: 'Operator name', required: true },
            { id: 't1', type: 'timer', label: 'Cure time', fieldName: 'cure', durationSeconds: 60, direction: 'countdown', blockDone: true },
          ],
        },
      ],
    },
  ],
}
const FIVE_DOC: FormDocument = {
  version: 2,
  sections: [
    {
      id: 's1',
      role: 'content',
      rows: [
        {
          id: 'r1',
          blocks: ['A', 'B', 'C', 'D', 'E'].map((label, i) => ({
            id: `b${i}`,
            type: 'textInput' as const,
            fieldName: `f${i}`,
            label,
            required: true,
          })),
        },
      ],
    },
  ],
}

const NAME_ROW = { id: 'r1', blocks: [{ id: 'b1', type: 'textInput' as const, fieldName: 'name', required: true }] }
const jobBtn = (id: string, job: 'continue' | 'yes' | 'no', extra: Record<string, unknown> = {}) =>
  ({ id, type: 'button' as const, label: '', outputValue: job, job, ...extra }) as FormDocument['sections'][number]['rows'][number]['blocks'][number]
const CONTINUE_JOB_DOC: FormDocument = {
  version: 2,
  sections: [
    { id: 's1', role: 'content', rows: [NAME_ROW] },
    { id: 's2', role: 'footer', rows: [{ id: 'r2', blocks: [jobBtn('j1', 'continue')] }] },
  ],
}
const YESNO_JOB_DOC: FormDocument = {
  version: 2,
  sections: [
    { id: 's1', role: 'content', rows: [NAME_ROW] },
    { id: 's2', role: 'footer', rows: [{ id: 'r2', blocks: [jobBtn('jy', 'yes'), jobBtn('jn', 'no')] }] },
  ],
}
const YESNO_ESIG_JOB_DOC: FormDocument = {
  version: 2,
  sections: [
    { id: 's1', role: 'content', rows: [ESIG_DOC.sections[0]!.rows[0]!] },
    { id: 's2', role: 'footer', rows: [{ id: 'r2', blocks: [jobBtn('jy', 'yes'), jobBtn('jn', 'no')] }] },
  ],
}
const CONTINUE_ESIG_JOB_DOC: FormDocument = {
  version: 2,
  sections: [
    { id: 's1', role: 'content', rows: [ESIG_DOC.sections[0]!.rows[0]!] },
    { id: 's2', role: 'footer', rows: [{ id: 'r2', blocks: [jobBtn('j1', 'continue')] }] },
  ],
}
const YESNO_PHONE_HIDDEN_DOC: FormDocument = {
  version: 2,
  sections: [
    { id: 's1', role: 'content', rows: [NAME_ROW] },
    {
      id: 's2',
      role: 'footer',
      rows: [{ id: 'r2', blocks: [jobBtn('jy', 'yes'), jobBtn('jn', 'no', { layout: { visible: { base: true, phone: false } } })] }],
    },
  ],
}
const JOBLESS_BUTTON_DOC: FormDocument = {
  version: 2,
  sections: [
    { id: 's1', role: 'content', rows: [NAME_ROW] },
    { id: 's2', role: 'footer', rows: [{ id: 'r2', blocks: [{ id: 'g1', type: 'button', label: 'Go', outputValue: 'go' }] }] },
  ],
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

describe('TaskScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastRendererProps = undefined
    rendererMountCount = 0
  })

  afterEach(cleanup)

  it('USER_INTERACTION + formDocument: Submit is disabled until a required field fills and validation reports ok', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    const t = task({ formDocument: REQUIRED_NAME_DOC })
    const onDone = vi.fn()

    render(<TaskScreen task={t} onDone={onDone} onError={vi.fn()} />)

    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)

    // renderer emits fieldChange then validation, as the real renderer does on a field edit
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'fieldChange', fieldName: 'name', value: 'Ada' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(api.submit).toHaveBeenCalledWith('a1', { kind: 'submit', values: { name: 'Ada' } })
  })

  it('YES_NO + formDocument: decision buttons carry the configured labels, disabled until the gate is ok, and submit a decision with values', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    const t = task({
      stepType: 'YES_NO',
      formDocument: REQUIRED_NAME_DOC,
      yesNoConfig: { yes_label: 'Approve', no_label: 'Reject' },
    })
    const onDone = vi.fn()

    render(<TaskScreen task={t} onDone={onDone} onError={vi.fn()} />)

    const yesButton = screen.getByRole('button', { name: 'Approve' })
    const noButton = screen.getByRole('button', { name: 'Reject' })
    expect((yesButton as HTMLButtonElement).disabled).toBe(true)
    expect((noButton as HTMLButtonElement).disabled).toBe(true)

    act(() => {
      lastRendererProps!.onEvent!({ kind: 'fieldChange', fieldName: 'name', value: 'Ada' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(false)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(api.submit).toHaveBeenCalledWith('a1', { kind: 'decision', value: 'yes', values: { name: 'Ada' } })
  })

  it('doc-less USER_INTERACTION: a single Continue button sends {kind: complete}', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    const t = task({ formDocument: null })
    const onDone = vi.fn()

    render(<TaskScreen task={t} onDone={onDone} onError={vi.fn()} />)

    expect(screen.queryByTestId('renderer')).toBeNull()
    const continueButton = screen.getByRole('button', { name: 'Continue' })
    expect((continueButton as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(continueButton)

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(api.submit).toHaveBeenCalledWith('a1', { kind: 'complete' })
  })

  it('doc-less YES_NO: decision buttons are enabled immediately (no gate)', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    const t = task({ stepType: 'YES_NO', formDocument: null, yesNoConfig: null })
    const onDone = vi.fn()

    render(<TaskScreen task={t} onDone={onDone} onError={vi.fn()} />)

    expect(screen.queryByTestId('renderer')).toBeNull()
    const yesButton = screen.getByRole('button', { name: 'Yes' })
    const noButton = screen.getByRole('button', { name: 'No' })
    expect((yesButton as HTMLButtonElement).disabled).toBe(false)
    expect((noButton as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(noButton)

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(api.submit).toHaveBeenCalledWith('a1', { kind: 'decision', value: 'no', values: undefined })
  })

  it('submit rejecting with a 409 ApiError calls onError with the race copy + kind, and does not call onDone', async () => {
    vi.mocked(api.submit).mockRejectedValue(new ApiError(409))
    const t = task({ formDocument: null })
    const onDone = vi.fn()
    const onError = vi.fn()

    render(<TaskScreen task={t} onDone={onDone} onError={onError} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(onError).toHaveBeenCalledWith('This task changed — refreshing.', 'race'))
    expect(onDone).not.toHaveBeenCalled()
  })

  it('submit rejecting with a 403 ApiError also calls onError with the race copy + kind', async () => {
    vi.mocked(api.submit).mockRejectedValue(new ApiError(403))
    const t = task({ formDocument: null })
    const onError = vi.fn()

    render(<TaskScreen task={t} onDone={vi.fn()} onError={onError} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(onError).toHaveBeenCalledWith('This task changed — refreshing.', 'race'))
  })

  it('submit rejecting with a non-race error (e.g. a network TypeError) calls onError with the generic copy + "other" kind, and does not call onDone', async () => {
    vi.mocked(api.submit).mockRejectedValue(new TypeError('Failed to fetch'))
    const t = task({ formDocument: null })
    const onDone = vi.fn()
    const onError = vi.fn()

    render(<TaskScreen task={t} onDone={onDone} onError={onError} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(onError).toHaveBeenCalledWith('Something went wrong — try again.', 'other'))
    expect(onDone).not.toHaveBeenCalled()
  })

  it('remounting with a task of a different stepInstanceId resets values — the renderer receives a freshly seeded values prop, not the stale typed one', async () => {
    const docWithDefault: FormDocument = {
      version: 2,
      sections: [
        {
          id: 's1',
          role: 'content',
          rows: [
            {
              id: 'r1',
              blocks: [{ id: 'b1', type: 'textInput', fieldName: 'name', defaultSource: { mode: 'static', value: 'Seed' } }],
            },
          ],
        },
      ],
    }
    const t1 = task({ stepInstanceId: 'si1', formDocument: docWithDefault })
    const onDone = vi.fn()

    const { rerender } = render(<TaskScreen task={t1} onDone={onDone} onError={vi.fn()} />)

    await waitFor(() => expect(lastRendererProps!.values).toEqual({ name: 'Seed' }))

    // the operator types over the seeded value
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'fieldChange', fieldName: 'name', value: 'Typed over' })
    })

    await waitFor(() => expect(lastRendererProps!.values).toEqual({ name: 'Typed over' }))

    const t2 = task({ stepInstanceId: 'si2', formDocument: docWithDefault })
    rerender(<TaskScreen task={t2} onDone={onDone} onError={vi.fn()} />)

    await waitFor(() => expect(lastRendererProps!.values).toEqual({ name: 'Seed' }))
  })

  it('the renderer remounts when stepInstanceId changes — pins key={task.stepInstanceId}', async () => {
    const t1 = task({ stepInstanceId: 'si1', formDocument: REQUIRED_NAME_DOC })
    const { rerender } = render(<TaskScreen task={t1} onDone={vi.fn()} onError={vi.fn()} />)

    await waitFor(() => expect(rendererMountCount).toBe(1))

    const t2 = task({ stepInstanceId: 'si2', formDocument: REQUIRED_NAME_DOC })
    rerender(<TaskScreen task={t2} onDone={vi.fn()} onError={vi.fn()} />)

    await waitFor(() => expect(rendererMountCount).toBe(2))
  })

  it('the renderer does NOT remount when the task object identity changes but stepInstanceId stays the same', async () => {
    const t1 = task({ stepInstanceId: 'si1', formDocument: REQUIRED_NAME_DOC, stepName: 'Before' })
    const { rerender } = render(<TaskScreen task={t1} onDone={vi.fn()} onError={vi.fn()} />)

    await waitFor(() => expect(rendererMountCount).toBe(1))

    // a fresh object reference (e.g. a re-fetched inbox snapshot) for the SAME step instance
    const t1Refetched = task({ stepInstanceId: 'si1', formDocument: REQUIRED_NAME_DOC, stepName: 'After' })
    expect(t1Refetched).not.toBe(t1)
    rerender(<TaskScreen task={t1Refetched} onDone={vi.fn()} onError={vi.fn()} />)

    expect(rendererMountCount).toBe(1)
  })

  it('the step heading is the after-Submit focus target; workflow and runtime ID now live in the context bar', () => {
    const t = task({ stepName: 'Fill weight', masterName: 'Grind & Brew', runtimeLabel: 'MIX-20261007-007' })

    render(<TaskScreen task={t} onDone={vi.fn()} onError={vi.fn()} />)

    const heading = screen.getByRole('heading', { name: 'Fill weight' })
    expect(heading.id).toBe('task-heading-a1')
    expect(heading.getAttribute('tabindex')).toBe('-1')
    expect(heading.className).toBe('task-heading')
    expect(screen.queryByText('Grind & Brew · MIX-20261007-007')).toBeNull()
  })

  it('typed values are saved as a draft and come back when the pane mounts again (spec §5.7)', () => {
    const first = render(<TaskScreen task={task({ formDocument: REQUIRED_NAME_DOC })} onDone={vi.fn()} onError={vi.fn()} />)
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'fieldChange', fieldName: 'name', value: 'Ada' })
    })
    expect(JSON.parse(sessionStorage.getItem('pilot:draft:a1')!)).toEqual({ stepInstanceId: 'si1', values: { name: 'Ada' } })
    first.unmount()

    render(<TaskScreen task={task({ formDocument: REQUIRED_NAME_DOC })} onDone={vi.fn()} onError={vi.fn()} />)

    expect(lastRendererProps!.values).toEqual({ name: 'Ada' })
    // The gate is computed from the restored values, so Submit is ready at once.
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a draft saved for an earlier step instance of the same assignment is not restored', () => {
    sessionStorage.setItem('pilot:draft:a1', JSON.stringify({ stepInstanceId: 'si-old', values: { name: 'Zed' } }))

    render(<TaskScreen task={task({ formDocument: REQUIRED_NAME_DOC })} onDone={vi.fn()} onError={vi.fn()} />)

    expect(lastRendererProps!.values).toEqual({})
  })

  it('a successful submit clears the draft', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    const onDone = vi.fn()
    render(<TaskScreen task={task({ formDocument: REQUIRED_NAME_DOC })} onDone={onDone} onError={vi.fn()} />)
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'fieldChange', fieldName: 'name', value: 'Ada' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })
    expect(sessionStorage.getItem('pilot:draft:a1')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(sessionStorage.getItem('pilot:draft:a1')).toBeNull()
  })

  it('falls back to stepOid for the heading when stepName is null', () => {
    const t = task({ stepName: null })

    render(<TaskScreen task={t} onDone={vi.fn()} onError={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'so1' })).toBeTruthy()
  })

  it('passes an images resolver mapping src keys to the instance image endpoint', () => {
    const t = task({ formDocument: REQUIRED_NAME_DOC, instanceId: 'inst-9' })

    render(<TaskScreen task={t} onDone={vi.fn()} onError={vi.fn()} />)

    const resolve = lastRendererProps!.images!
    expect(resolve('photo.png')).toBe('/api/instances/inst-9/images/photo.png')
    // URL-hostile characters in the filename must be escaped
    expect(resolve('a b#c.png')).toBe('/api/instances/inst-9/images/a%20b%23c.png')
    // data URIs are already displayable — pass through untouched
    expect(resolve('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    // Designer's palette default sentinel has no bytes anywhere — keep the placeholder
    expect(resolve('No image selected')).toBeUndefined()
  })

  it('every action chrome variant (Submit / Continue / Yes-No) renders inside the .task-actions container', () => {
    const submit = render(<TaskScreen task={task({ formDocument: REQUIRED_NAME_DOC })} onDone={vi.fn()} onError={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Continue' }).closest('.task-actions')).toBeTruthy()
    submit.unmount()

    const cont = render(<TaskScreen task={task({ formDocument: null })} onDone={vi.fn()} onError={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Continue' }).closest('.task-actions')).toBeTruthy()
    cont.unmount()

    render(<TaskScreen task={task({ stepType: 'YES_NO' })} onDone={vi.fn()} onError={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Yes' }).closest('.task-actions')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'No' }).closest('.task-actions')).toBeTruthy()
  })

  // 2026-09-14: the label authored in Designer's Actions panel (InboxTask.continueLabel) replaces the
  // default completion label on both the form chrome (Submit) and the doc-less chrome (Continue).
  it('continueLabel renames the completion button on the form and doc-less chrome', () => {
    const form = render(
      <TaskScreen task={task({ formDocument: REQUIRED_NAME_DOC, continueLabel: 'Record Reading' })} onDone={vi.fn()} onError={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Record Reading' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    form.unmount()

    render(<TaskScreen task={task({ formDocument: null, continueLabel: 'Record Reading' })} onDone={vi.fn()} onError={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Record Reading' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('continueLabel with an e-signature block reads "Sign & {label}"', () => {
    render(
      <TaskScreen task={task({ formDocument: ESIG_DOC, continueLabel: 'Approve Timesheet' })} me={ME} onDone={vi.fn()} onError={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Sign & Approve Timesheet' })).toBeTruthy()
  })

  it('a label that already starts with Sign is not prefixed again ("Sign and Save", never "Sign & Sign and Save")', () => {
    const a = render(
      <TaskScreen task={task({ formDocument: ESIG_DOC, continueLabel: 'Sign off' })} me={ME} onDone={vi.fn()} onError={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Sign off' })).toBeTruthy()
    a.unmount()
    render(
      <TaskScreen
        task={task({ stepType: 'YES_NO', formDocument: ESIG_DOC, yesNoConfig: { yes_label: 'Sign and Save', no_label: 'Cancel Signing' } })}
        me={ME}
        onDone={vi.fn()}
        onError={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Sign and Save' })).toBeTruthy()
  })

  it('offline disables Continue even when nothing else would gate it', () => {
    const t = task({ formDocument: null })

    render(<TaskScreen task={t} onDone={vi.fn()} onError={vi.fn()} offline />)

    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a malformed formDocument (no sections array) is treated as absent — renders the doc-less Continue chrome', () => {
    const t = task({ formDocument: { bogus: true } })

    render(<TaskScreen task={t} onDone={vi.fn()} onError={vi.fn()} />)

    expect(screen.queryByTestId('renderer')).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('paused: shows the paused notice and disables the Continue action', () => {
    render(<TaskScreen task={task({ paused: true })} onDone={vi.fn()} onError={vi.fn()} />)

    expect(screen.getByText('Paused — actions are disabled until this step resumes.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('paused: Submit stays disabled even when the gate passes, and authored action events are ignored', () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    const t = task({ paused: true, formDocument: REQUIRED_NAME_DOC })
    render(<TaskScreen task={t} onDone={vi.fn()} onError={vi.fn()} />)

    act(() => {
      lastRendererProps!.onEvent!({ kind: 'fieldChange', fieldName: 'name', value: 'Ada' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })

    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)

    act(() => {
      lastRendererProps!.onEvent!({ kind: 'action', blockId: 'b1', outputValue: 'go' })
    })
    expect(api.submit).not.toHaveBeenCalled()
  })

  it('not paused: no paused notice renders', () => {
    render(<TaskScreen task={task()} onDone={vi.fn()} onError={vi.fn()} />)
    expect(screen.queryByText('Paused — actions are disabled until this step resumes.')).toBeNull()
  })

  it('a gated Submit lists what is missing beside it, then says Ready to submit once the gate is ok', async () => {
    render(<TaskScreen task={task({ formDocument: LABELLED_DOC })} onDone={vi.fn()} onError={vi.fn()} />)

    const submit = screen.getByRole('button', { name: 'Continue' })
    // The disabled button points at its reason for assistive technology.
    expect(submit.getAttribute('aria-describedby')).toBe('missing-a1')
    expect(document.getElementById('missing-a1')!.textContent).toBe('Missing: Operator name')
    expect(screen.queryByText('Ready to submit')).toBeNull()

    act(() => {
      lastRendererProps!.onEvent!({ kind: 'fieldChange', fieldName: 'name', value: 'Ada' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })

    await waitFor(() => expect(screen.queryByText(/Missing:/)).toBeNull())
    expect(screen.getByRole('button', { name: 'Continue' }).getAttribute('aria-describedby')).toBeNull()
    expect(screen.getByText('Ready to submit')).toBeTruthy()
  })

  it('YES_NO shows the missing line too (Yes is gated by the same form)', () => {
    render(
      <TaskScreen
        task={task({ stepType: 'YES_NO', formDocument: REQUIRED_NAME_DOC })}
        onDone={vi.fn()}
        onError={vi.fn()}
      />,
    )
    expect(document.getElementById('missing-a1')!.textContent).toBe('Missing: name')
  })

  it('a doc-less Continue never shows a missing line or Ready to submit', () => {
    render(<TaskScreen task={task({ formDocument: null })} onDone={vi.fn()} onError={vi.fn()} />)
    expect(screen.queryByText(/Missing:/)).toBeNull()
    expect(screen.queryByText('Ready to submit')).toBeNull()
  })

  it('a missing-field link scrolls to that field and focuses it (spec §5.4)', () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    try {
      render(<TaskScreen task={task({ formDocument: LABELLED_DOC })} onDone={vi.fn()} onError={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: 'Operator name' }))

      expect(document.activeElement).toBe(screen.getByLabelText('field name'))
      expect(scrolled).toHaveBeenCalledWith({ block: 'center' })
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  it('a running timer reads "Waiting for", not as a field to fill in (P0)', () => {
    render(<TaskScreen task={task({ formDocument: TIMER_DOC })} onDone={vi.fn()} onError={vi.fn()} />)

    expect(document.querySelector('.task-missing-fields')!.textContent).toBe('Missing: Operator name')
    expect(document.querySelector('.task-waiting')!.textContent).toBe('Waiting for: Cure time')
    expect(screen.queryByRole('button', { name: 'Cure time' })).toBeNull()
  })

  it('a long missing list shows three links and a "+N more" that reveals the rest (P0)', () => {
    render(<TaskScreen task={task({ formDocument: FIVE_DOC })} onDone={vi.fn()} onError={vi.fn()} />)
    const links = () => [...document.querySelectorAll('.task-missing-fields .link-btn')].map((b) => b.textContent)

    expect(links()).toEqual(['A', 'B', 'C', '+2 more'])
    fireEvent.click(screen.getByRole('button', { name: '+2 more' }))
    expect(links()).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('No points at the missing reason when it is gated, and not when only the signature is missing (P0)', () => {
    const gated = render(
      <TaskScreen task={task({ stepType: 'YES_NO', formDocument: REQUIRED_NAME_DOC })} onDone={vi.fn()} onError={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'No' }).getAttribute('aria-describedby')).toBe('missing-a1')
    gated.unmount()

    render(<TaskScreen task={task({ stepType: 'YES_NO', formDocument: ESIG_DOC })} onDone={vi.fn()} onError={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'No' }).getAttribute('aria-describedby')).toBeNull()
  })


  it('Release in the footer asks before discarding typed values, then releases, clears the draft and reports it', async () => {
    vi.mocked(api.release).mockResolvedValue(undefined)
    const onReleased = vi.fn()
    render(
      <TaskScreen task={task({ formDocument: REQUIRED_NAME_DOC })} onDone={vi.fn()} onError={vi.fn()} onReleased={onReleased} />,
    )
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'fieldChange', fieldName: 'name', value: 'Ada' })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(screen.getByRole('alert').textContent).toBe('Release and discard 1 entered value?')
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))

    await waitFor(() => expect(onReleased).toHaveBeenCalledTimes(1))
    expect(api.release).toHaveBeenCalledWith('a1')
    expect(sessionStorage.getItem('pilot:draft:a1')).toBeNull()
  })

  it('a release that lost the race is reported as a race', async () => {
    vi.mocked(api.release).mockRejectedValue(new ApiError(409))
    const onError = vi.fn()
    render(<TaskScreen task={task()} onDone={vi.fn()} onError={onError} />)

    fireEvent.click(screen.getByRole('button', { name: 'Release' }))

    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not release', 'race'))
  })

  it('Release is disabled offline', () => {
    render(<TaskScreen task={task()} onDone={vi.fn()} onError={vi.fn()} offline />)
    expect((screen.getByRole('button', { name: 'Release' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('"Where you are" opens as a sheet; a pane that is not on screen never fetches it (spec §4)', () => {
    // The api mock has no runtimeDiagram/runtimeLiveStates: any fetch from this
    // background pane (active defaults to false) would throw and fail the test.
    render(<TaskScreen task={task()} onDone={vi.fn()} onError={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Where you are' }))

    const sheet = screen.getByRole('dialog', { name: 'Where you are in MIX-20261007-001' })
    expect(within(sheet).getByRole('navigation', { name: 'Where you are in MIX-20261007-001' })).toBeTruthy()
  })

  it('passes the resolved form surface to the renderer (spec §14)', () => {
    render(<TaskScreen task={task({ formDocument: REQUIRED_NAME_DOC })} onDone={vi.fn()} onError={vi.fn()} surfaceColor="rgb(19, 28, 46)" />)
    expect(lastRendererProps!.surfaceColor).toBe('rgb(19, 28, 46)')
  })

  const ctrlEnter = (target: Element | Document = document.body) =>
    fireEvent.keyDown(target, { key: 'Enter', code: 'Enter', ctrlKey: true })

  // An `active` pane loads "Where you are". This file's api mock deliberately lacks those
  // two calls (the "never fetches" test relies on that), so stub them for one test only.
  function stubWhereApi() {
    const a = api as unknown as Record<string, unknown>
    a.runtimeDiagram = vi.fn(() => new Promise(() => {}))
    a.runtimeLiveStates = vi.fn(() => new Promise(() => {}))
    onTestFinished(() => {
      delete a.runtimeDiagram
      delete a.runtimeLiveStates
    })
  }

  it('Ctrl+Enter presses an enabled Submit, even from inside a field (P4-R2)', async () => {
    stubWhereApi()
    vi.mocked(api.submit).mockResolvedValue(undefined)
    render(<TaskScreen task={task({ formDocument: REQUIRED_NAME_DOC })} onDone={vi.fn()} onError={vi.fn()} active />)
    ctrlEnter()
    expect(api.submit).not.toHaveBeenCalled() // gate not ok: Submit is disabled
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'fieldChange', fieldName: 'name', value: 'Ada' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })
    ctrlEnter(screen.getByLabelText('field name'))
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith('a1', { kind: 'submit', values: { name: 'Ada' } }))
    expect(screen.getByRole('button', { name: 'Continue' }).getAttribute('aria-keyshortcuts')).toBe('Control+Enter')
  })

  it('Ctrl+Enter does nothing in a background pane, offline, or on a Yes/No step', () => {
    stubWhereApi()
    const view = render(<TaskScreen task={task()} onDone={vi.fn()} onError={vi.fn()} active={false} />)
    ctrlEnter()
    view.rerender(<TaskScreen task={task()} onDone={vi.fn()} onError={vi.fn()} active offline />)
    ctrlEnter()
    view.rerender(<TaskScreen task={task({ stepType: 'YES_NO' })} onDone={vi.fn()} onError={vi.fn()} active />)
    ctrlEnter()
    expect(api.submit).not.toHaveBeenCalled()
  })

  it('Ctrl+Enter does nothing while the Release question is showing', () => {
    stubWhereApi()
    render(<TaskScreen task={task({ formDocument: REQUIRED_NAME_DOC })} onDone={vi.fn()} onError={vi.fn()} active />)
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'fieldChange', fieldName: 'name', value: 'Ada' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(screen.getByRole('group', { name: 'Confirm release' })).toBeTruthy()
    ctrlEnter()
    expect(api.submit).not.toHaveBeenCalled()
  })
})

describe('TaskScreen — e-signature (spec 2026-09-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastRendererProps = undefined
  })
  afterEach(cleanup)

  it('labels: the default reads "Continue" (as in the Designer preview), "Sign & Continue" with a block; Yes reads "Sign & {yes}", No is unchanged', () => {
    const a = render(<TaskScreen task={task({ formDocument: ESIG_DOC })} me={ME} onDone={vi.fn()} onError={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Sign & Continue' })).toBeTruthy()
    a.unmount()
    const b = render(<TaskScreen task={task({ formDocument: REQUIRED_NAME_DOC })} me={ME} onDone={vi.fn()} onError={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
    b.unmount()
    render(
      <TaskScreen
        task={task({ stepType: 'YES_NO', formDocument: ESIG_DOC, yesNoConfig: { yes_label: 'Approve', no_label: 'Reject' } })}
        me={ME}
        onDone={vi.fn()}
        onError={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Sign & Approve' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy()
  })

  it('prefills the operator login name unless the block requires a different user, which shows a hint instead', () => {
    const a = render(<TaskScreen task={task({ formDocument: ESIG_DOC })} me={ME} onDone={vi.fn()} onError={vi.fn()} />)
    expect(lastRendererProps!.signature).toEqual({ loginName: 'jane.op', password: '' })
    expect(lastRendererProps!.signatureHint).toBeNull()
    a.unmount()
    render(<TaskScreen task={task({ formDocument: ESIG_DIFFERENT_USER_DOC })} me={ME} onDone={vi.fn()} onError={vi.fn()} />)
    expect(lastRendererProps!.signature).toEqual({ loginName: '', password: '' })
    expect(lastRendererProps!.signatureHint).toBe('Must be signed by someone other than Jane Operator')
  })

  it('the gate stays closed until both signature fields are filled (real computeValidation with the draft)', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    render(<TaskScreen task={task({ formDocument: ESIG_DOC })} me={ME} onDone={vi.fn()} onError={vi.fn()} />)
    const button = () => screen.getByRole('button', { name: 'Sign & Continue' }) as HTMLButtonElement
    expect(button().disabled).toBe(true)
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'signature', blockId: 'e1', loginName: 'jane.op', password: 'pw' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })
    await waitFor(() => expect(button().disabled).toBe(false))
    expect(lastRendererProps!.signature).toEqual({ loginName: 'jane.op', password: 'pw' })
    fireEvent.click(button())
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith('a1', { kind: 'submit', values: {}, signature: { loginName: 'jane.op', password: 'pw' } }))
  })

  it('Yes carries the signature, No never does', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    render(
      <TaskScreen task={task({ stepType: 'YES_NO', formDocument: ESIG_DOC })} me={ME} onDone={vi.fn()} onError={vi.fn()} />,
    )
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'signature', blockId: 'e1', loginName: 'jane.op', password: 'pw' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })
    await waitFor(() => expect((screen.getByRole('button', { name: 'No' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith('a1', { kind: 'decision', value: 'no', values: {} }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign & Yes' }))
    await waitFor(() =>
      expect(api.submit).toHaveBeenCalledWith('a1', { kind: 'decision', value: 'yes', values: {}, signature: { loginName: 'jane.op', password: 'pw' } }),
    )
  })

  it('spec D5: No is exempt from a missing signature alone — an empty draft leaves No clickable while Yes stays gated, and No sends no signature', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    render(
      <TaskScreen
        task={task({ stepType: 'YES_NO', formDocument: ESIG_DOC, yesNoConfig: { yes_label: 'Approve', no_label: 'Reject' } })}
        me={ME}
        onDone={vi.fn()}
        onError={vi.fn()}
      />,
    )
    // Empty draft: the esignature block's fieldName is the ONLY entry in gate.missing.
    expect((screen.getByRole('button', { name: 'Sign & Approve' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith('a1', { kind: 'decision', value: 'no', values: {} }))
  })

  it('spec D5: a missing NON-signature required field still gates No — the exemption is signature-only', () => {
    const docWithRequiredAndEsig: FormDocument = {
      version: 2,
      sections: [
        {
          id: 's1',
          role: 'content',
          rows: [{ id: 'r0', blocks: [{ id: 'b1', type: 'textInput', fieldName: 'name', required: true }] }, ...ESIG_DOC.sections[0]!.rows],
        },
      ],
    }
    render(
      <TaskScreen
        task={task({ stepType: 'YES_NO', formDocument: docWithRequiredAndEsig, yesNoConfig: { yes_label: 'Approve', no_label: 'Reject' } })}
        me={ME}
        onDone={vi.fn()}
        onError={vi.fn()}
      />,
    )
    // gate.missing is ['name', 'approval'] — not signature-only — so No stays gated too.
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a SIGNATURE_* 403 shows the inline copy, clears the password, keeps values, and never calls onError', async () => {
    vi.mocked(api.submit).mockRejectedValue(new ApiError(403, 'SIGNATURE_INVALID_CREDENTIALS', 'Login name or password is incorrect'))
    const onError = vi.fn()
    render(
      <TaskScreen
        task={task({ formDocument: { ...ESIG_DOC, sections: [{ ...ESIG_DOC.sections[0]!, rows: [{ id: 'r1', blocks: [{ id: 'b1', type: 'textInput', fieldName: 'name' }, ...ESIG_DOC.sections[0]!.rows[0]!.blocks] }] }] } })}
        me={ME}
        onDone={vi.fn()}
        onError={onError}
      />,
    )
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'fieldChange', fieldName: 'name', value: 'Ada' })
      lastRendererProps!.onEvent!({ kind: 'signature', blockId: 'e1', loginName: 'jane.op', password: 'wrong' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })
    await waitFor(() => expect((screen.getByRole('button', { name: 'Sign & Continue' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Sign & Continue' }))
    await waitFor(() => expect(lastRendererProps!.signatureError).toBe('Login name or password is incorrect'))
    expect(lastRendererProps!.signature).toEqual({ loginName: 'jane.op', password: '' })
    expect(lastRendererProps!.values).toEqual({ name: 'Ada' })
    expect(onError).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sign & Continue' })).toBeTruthy()
    // typing again clears the error
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'signature', blockId: 'e1', loginName: 'jane.op', password: 'p' })
    })
    await waitFor(() => expect(lastRendererProps!.signatureError).toBeNull())
  })

  it('a SIGNATURE_* 403 re-disables the primary button immediately (no stale gate) — a fresh password re-enables it, login name and form values stay put', async () => {
    vi.mocked(api.submit).mockRejectedValue(new ApiError(403, 'SIGNATURE_INVALID_CREDENTIALS', 'Login name or password is incorrect'))
    render(
      <TaskScreen
        task={task({ formDocument: { ...ESIG_DOC, sections: [{ ...ESIG_DOC.sections[0]!, rows: [{ id: 'r1', blocks: [{ id: 'b1', type: 'textInput', fieldName: 'name' }, ...ESIG_DOC.sections[0]!.rows[0]!.blocks] }] }] } })}
        me={ME}
        onDone={vi.fn()}
        onError={vi.fn()}
      />,
    )
    const button = () => screen.getByRole('button', { name: 'Sign & Continue' }) as HTMLButtonElement
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'fieldChange', fieldName: 'name', value: 'Ada' })
      lastRendererProps!.onEvent!({ kind: 'signature', blockId: 'e1', loginName: 'jane.op', password: 'wrong' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })
    await waitFor(() => expect(button().disabled).toBe(false))
    fireEvent.click(button())
    // Wait for the rejection to actually settle (submitting flips back to false in the same
    // batch as the error state) before asserting `disabled` — otherwise a transient
    // `submitting`-driven disable during the in-flight request would give a false pass.
    await waitFor(() => expect(lastRendererProps!.signatureError).toBe('Login name or password is incorrect'))
    // The host cleared the password itself (not a renderer event), so nothing else would
    // ever recompute the gate — it must re-disable the button on its own, immediately.
    expect(button().disabled).toBe(true)
    expect(lastRendererProps!.signature).toEqual({ loginName: 'jane.op', password: '' })
    expect(lastRendererProps!.values).toEqual({ name: 'Ada' })
    // typing a fresh password through the (rendered) password input — the real renderer
    // emits `signature` immediately followed by its own `validation`
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'signature', blockId: 'e1', loginName: 'jane.op', password: 'right' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })
    await waitFor(() => expect(button().disabled).toBe(false))
    expect(lastRendererProps!.signature).toEqual({ loginName: 'jane.op', password: 'right' })
    expect(lastRendererProps!.values).toEqual({ name: 'Ada' })
  })

  it('maps every server code to client copy, falling back to the server message for role codes', async () => {
    const cases: [string, string | undefined, string][] = [
      ['SIGNATURE_SAME_USER', undefined, 'A different user than the operator must sign'],
      ['SIGNATURE_NOT_MEMBER', undefined, 'That user is not a member of this work center'],
      ['SIGNATURE_ROLE_UNKNOWN', 'No role named "QA Lead" exists', 'No role named "QA Lead" exists'],
      ['SIGNATURE_ROLE_MISSING', 'jane does not hold QA Lead here', 'jane does not hold QA Lead here'],
      ['SIGNATURE_REQUIRED', undefined, 'Sign to continue'],
    ]
    for (const [code, message, expected] of cases) {
      vi.mocked(api.submit).mockRejectedValueOnce(new ApiError(code === 'SIGNATURE_REQUIRED' ? 400 : 403, code, message))
      const r = render(<TaskScreen task={task({ formDocument: ESIG_DOC })} me={ME} onDone={vi.fn()} onError={vi.fn()} />)
      act(() => {
        lastRendererProps!.onEvent!({ kind: 'signature', blockId: 'e1', loginName: 'x', password: 'y' })
        lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
      })
      await waitFor(() => expect((screen.getByRole('button', { name: 'Sign & Continue' }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name: 'Sign & Continue' }))
      await waitFor(() => expect(lastRendererProps!.signatureError).toBe(expected))
      r.unmount()
    }
  })

  it('a non-signature 403 still takes the race path', async () => {
    vi.mocked(api.submit).mockRejectedValue(new ApiError(403, 'NOT_CLAIMANT'))
    const onError = vi.fn()
    render(<TaskScreen task={task({ formDocument: ESIG_DOC })} me={ME} onDone={vi.fn()} onError={onError} />)
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'signature', blockId: 'e1', loginName: 'x', password: 'y' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })
    await waitFor(() => expect((screen.getByRole('button', { name: 'Sign & Continue' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Sign & Continue' }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('This task changed — refreshing.', 'race'))
  })

  it('a new step instance resets the draft and the error', async () => {
    const t1 = task({ stepInstanceId: 'si1', formDocument: ESIG_DOC })
    const { rerender } = render(<TaskScreen task={t1} me={ME} onDone={vi.fn()} onError={vi.fn()} />)
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'signature', blockId: 'e1', loginName: 'other', password: 'pw' })
    })
    await waitFor(() => expect(lastRendererProps!.signature).toEqual({ loginName: 'other', password: 'pw' }))
    rerender(<TaskScreen task={task({ stepInstanceId: 'si2', formDocument: ESIG_DOC })} me={ME} onDone={vi.fn()} onError={vi.fn()} />)
    await waitFor(() => expect(lastRendererProps!.signature).toEqual({ loginName: 'jane.op', password: '' }))
  })
})

describe('TaskScreen — job buttons (spec 2026-10-28 §5.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastRendererProps = undefined
  })
  afterEach(cleanup)

  const pass = () =>
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'fieldChange', fieldName: 'name', value: 'Ada' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })

  it("a form with job buttons hides Pilot's Continue/Yes/No but keeps Release and the missing/ready strip", async () => {
    const a = render(<TaskScreen task={task({ formDocument: CONTINUE_JOB_DOC })} onDone={vi.fn()} onError={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Release' })).toBeTruthy()
    expect(document.getElementById('missing-a1')!.textContent).toBe('Missing: name')
    pass()
    await waitFor(() => expect(screen.getByText('Ready to submit')).toBeTruthy())
    a.unmount()

    render(<TaskScreen task={task({ stepType: 'YES_NO', formDocument: YESNO_JOB_DOC })} onDone={vi.fn()} onError={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'No' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Release' })).toBeTruthy()
  })

  it('a form that owns its buttons gets the compact action strip and a pinned bottom bar; other forms keep the full strip', () => {
    const a = render(<TaskScreen task={task({ formDocument: CONTINUE_JOB_DOC })} onDone={vi.fn()} onError={vi.fn()} />)
    expect(a.container.querySelector('footer.task-actions')!.classList.contains('task-actions-compact')).toBe(true)
    expect(a.container.querySelector('main')!.classList.contains('task-owns-buttons')).toBe(true)
    a.unmount()

    for (const doc of [JOBLESS_BUTTON_DOC, YESNO_PHONE_HIDDEN_DOC, REQUIRED_NAME_DOC]) {
      const b = render(
        <TaskScreen
          task={task({ stepType: doc === YESNO_PHONE_HIDDEN_DOC ? 'YES_NO' : 'USER_INTERACTION', formDocument: doc })}
          onDone={vi.fn()}
          onError={vi.fn()}
        />,
      )
      expect(b.container.querySelector('footer.task-actions')!.classList.contains('task-actions-compact')).toBe(false)
      expect(b.container.querySelector('main')!.classList.contains('task-owns-buttons')).toBe(false)
      b.unmount()
    }
  })

  it("buttonJobs mirror Pilot's gating: continue disabled until the gate passes, then a job press submits signed values", async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    render(<TaskScreen task={task({ formDocument: CONTINUE_JOB_DOC })} onDone={vi.fn()} onError={vi.fn()} />)
    expect(lastRendererProps!.buttonJobs!.continue.enabled).toBe(false)
    expect(lastRendererProps!.buttonJobs!.continue.describedBy).toBe('missing-a1')
    expect(lastRendererProps!.buttonJobs!.yes.enabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'job continue' }))
    expect(api.submit).not.toHaveBeenCalled()

    pass()
    await waitFor(() => expect(lastRendererProps!.buttonJobs!.continue.enabled).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'job continue' }))
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith('a1', { kind: 'submit', values: { name: 'Ada' } }))
  })

  it('Yes/No job presses send decisions; No stays enabled when only the signature is missing (spec D5)', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    render(
      <TaskScreen task={task({ stepType: 'YES_NO', formDocument: YESNO_ESIG_JOB_DOC })} me={ME} onDone={vi.fn()} onError={vi.fn()} />,
    )
    const jobs = () => lastRendererProps!.buttonJobs!
    expect(jobs().yes.enabled).toBe(false)
    expect(jobs().no.enabled).toBe(true)
    expect(jobs().continue.enabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'job yes' }))
    expect(api.submit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'job no' }))
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith('a1', { kind: 'decision', value: 'no', values: {} }))

    act(() => {
      lastRendererProps!.onEvent!({ kind: 'signature', blockId: 'e1', loginName: 'jane.op', password: 'pw' })
      lastRendererProps!.onEvent!({ kind: 'validation', ok: true, missing: [] })
    })
    await waitFor(() => expect(jobs().yes.enabled).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'job yes' }))
    await waitFor(() =>
      expect(api.submit).toHaveBeenCalledWith('a1', {
        kind: 'decision',
        value: 'yes',
        values: {},
        signature: { loginName: 'jane.op', password: 'pw' },
      }),
    )
  })

  it('a job button that does not fit the step kind does nothing', () => {
    render(<TaskScreen task={task({ stepType: 'YES_NO', formDocument: CONTINUE_JOB_DOC })} onDone={vi.fn()} onError={vi.fn()} />)
    pass()
    act(() => {
      lastRendererProps!.onEvent!({ kind: 'job', blockId: 'j1', job: 'continue' })
    })
    expect(api.submit).not.toHaveBeenCalled()
  })

  it('job presses do nothing while paused, offline, or submitting', async () => {
    let resolve!: () => void
    vi.mocked(api.submit).mockImplementation(() => new Promise<undefined>((r) => (resolve = () => r(undefined))))
    const press = (job: 'continue' | 'yes' | 'no') =>
      act(() => {
        lastRendererProps!.onEvent!({ kind: 'job', blockId: 'x', job })
      })

    const paused = render(<TaskScreen task={task({ paused: true, formDocument: CONTINUE_JOB_DOC })} onDone={vi.fn()} onError={vi.fn()} />)
    pass()
    expect(lastRendererProps!.buttonJobs!.continue.enabled).toBe(false)
    press('continue')
    paused.unmount()

    const off = render(<TaskScreen task={task({ formDocument: CONTINUE_JOB_DOC })} onDone={vi.fn()} onError={vi.fn()} offline />)
    pass()
    press('continue')
    off.unmount()
    expect(api.submit).not.toHaveBeenCalled()

    render(<TaskScreen task={task({ formDocument: CONTINUE_JOB_DOC })} onDone={vi.fn()} onError={vi.fn()} />)
    pass()
    press('continue')
    expect(api.submit).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(lastRendererProps!.buttonJobs!.continue.enabled).toBe(false)) // submitting
    press('continue')
    expect(api.submit).toHaveBeenCalledTimes(1)
    await act(async () => resolve())
  })

  it('continue job label follows task.continueLabel; signed is true with an e-signature block', () => {
    const a = render(
      <TaskScreen task={task({ formDocument: CONTINUE_ESIG_JOB_DOC, continueLabel: 'Save batch' })} me={ME} onDone={vi.fn()} onError={vi.fn()} />,
    )
    expect(lastRendererProps!.buttonJobs!.continue.label).toBe('Save batch')
    expect(lastRendererProps!.buttonJobs!.signed).toBe(true)
    a.unmount()
    render(<TaskScreen task={task({ formDocument: CONTINUE_JOB_DOC })} onDone={vi.fn()} onError={vi.fn()} />)
    expect(lastRendererProps!.buttonJobs!.continue.label).toBe('Continue')
    expect(lastRendererProps!.buttonJobs!.signed).toBe(false)
  })

  it("a form whose job buttons would leave the operator stuck keeps Pilot's own buttons", () => {
    render(<TaskScreen task={task({ stepType: 'YES_NO', formDocument: YESNO_PHONE_HIDDEN_DOC })} onDone={vi.fn()} onError={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Yes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'No' })).toBeTruthy()
  })

  it("a job-less authored button changes nothing: Pilot's buttons stay and its action still submits", async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    render(<TaskScreen task={task({ formDocument: JOBLESS_BUTTON_DOC })} onDone={vi.fn()} onError={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
    pass()
    fireEvent.click(screen.getByRole('button', { name: 'job none' }))
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith('a1', { kind: 'submit', values: { name: 'Ada' } }))
  })

  it('Ctrl+Enter still submits when Continue is a job button', async () => {
    vi.mocked(api.submit).mockResolvedValue(undefined)
    const a = api as unknown as Record<string, unknown>
    a.runtimeDiagram = vi.fn(() => new Promise(() => {}))
    a.runtimeLiveStates = vi.fn(() => new Promise(() => {}))
    onTestFinished(() => {
      delete a.runtimeDiagram
      delete a.runtimeLiveStates
    })
    render(<TaskScreen task={task({ formDocument: CONTINUE_JOB_DOC })} onDone={vi.fn()} onError={vi.fn()} active />)
    pass()
    fireEvent.keyDown(document.body, { key: 'Enter', code: 'Enter', ctrlKey: true })
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith('a1', { kind: 'submit', values: { name: 'Ada' } }))
  })
})
