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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FormDocumentView } from '@mission/form-renderer'
import type { ButtonJobs } from '@mission/form-renderer'
import { checkNeverStuck, computeValidation, findESignatureBlock, hasJobButtons, signedLabel } from '@mission/form-schema'
import type { FormDocument, FormEvent, FormValues, SignatureDraft } from '@mission/form-schema'
import { api, ApiError } from '../api/client'
import type { InboxTask, Me, SubmitBody } from '../api/types'
import { seedDefaults, EMPTY_TIMERS } from '../host/gate'
import { missingItems, type MissingItem } from './missing-fields'
import { MissingFields } from '../task/MissingFields'
import { ReleaseButton } from '../task/ReleaseButton'
import { RuntimeId } from '../frame/RuntimeId'
import { Sheet } from '../frame/Sheet'
import { useShortcut } from '../frame/shortcuts'
import { useWhereYouAre } from '../task/useWhereYouAre'
import { WhereYouAre } from '../task/WhereYouAre'
import { clearDraft, readDraft, typedValues, writeDraft } from '../task/drafts'

// `kind` lets the caller (App) tell a lost race from a transient failure apart:
// - 'race' (403/409 — someone else already claimed/submitted this step): the task is
//   dead, so App navigates back to the inbox on top of showing the toast.
// - 'other' (network blip, 5xx, etc.): the task is still live, so App leaves the
//   operator on this screen with whatever they've typed still in place.
export type TaskErrorKind = 'race' | 'other'

export interface TaskScreenProps {
  task: InboxTask
  onDone(): void
  onError(msg: string, kind: TaskErrorKind): void
  // App (Task 8) threads its own connectivity state down here — offline disables every
  // action button (Continue/Submit/decision) regardless of what the gate would otherwise
  // allow, since a claim/submit while offline can't reach the engine anyway.
  offline?: boolean
  /** The signed-in operator (spec 2026-09-06 §6): prefills the signature login name, or names who must NOT sign. */
  me?: Pick<Me, 'loginName' | 'displayName'> | null
  /** Release succeeded (spec §5.4): the work view closes this pane and moves on. */
  onReleased?(): void
  /** Focus just moved here after a Submit/Release: show the "Now on" cue (spec §5.6 item 2). */
  arrived?: boolean
  /** The operator touched or typed in this pane — the cue has done its job. */
  onArrivalSeen?(): void
  /** This pane is the one on screen — only then does it load "Where you are" (spec §4). */
  active?: boolean
  /** The resolved form surface (spec §14): FormKit drops authored colours unreadable on it. */
  surfaceColor?: string
}

interface Gate {
  ok: boolean
  missing: string[]
}

interface YesNoLabels {
  yes_label?: string
  no_label?: string
}

const CHANGED_COPY = 'This task changed — refreshing.'
const GENERIC_ERROR_COPY = 'Something went wrong — try again.'
const RELEASE_RACE_COPY = 'Could not release'
const PAUSED_COPY = 'Paused — actions are disabled until this step resumes.'
const YES_NO = 'YES_NO'

const NO_GATE: Gate = { ok: true, missing: [] }

// Spec 2026-09-06 §6 — client copy for the engine's signature codes; role codes carry the
// server's own message (it names the role), everything else falls back to the server message.
const SIGNATURE_COPY: Record<string, string> = {
  SIGNATURE_REQUIRED: 'Sign to continue',
  SIGNATURE_INVALID_CREDENTIALS: 'Login name or password is incorrect',
  SIGNATURE_SAME_USER: 'A different user than the operator must sign',
  SIGNATURE_NOT_MEMBER: 'That user is not a member of this work center',
}
const SIGNATURE_FALLBACK_COPY = 'The signature was rejected — try again.'

function gateFor(doc: FormDocument | null, values: FormValues, signature: SignatureDraft): Gate {
  return doc ? computeValidation(doc, values, EMPTY_TIMERS, signature) : NO_GATE
}

// `ApiError.message` is `HTTP <status>` when the server sent no `error` text, so that
// placeholder never reaches the operator — fall back to the generic signature copy instead.
function signatureCopy(err: ApiError): string {
  const mapped = SIGNATURE_COPY[err.code ?? '']
  if (mapped) return mapped
  return err.message && !err.message.startsWith('HTTP ') ? err.message : SIGNATURE_FALLBACK_COPY
}

// The wire payload types `formDocument` as `unknown` (api/types.ts) — this is the one
// place that trusts it into a real FormDocument. A malformed/absent shape (missing or
// non-array `sections`) is treated as no document at all, so a bad payload degrades to
// the doc-less Continue chrome instead of throwing when seedDefaults/computeValidation
// walk `doc.sections`.
function asFormDocument(raw: unknown): FormDocument | null {
  if (raw === null || typeof raw !== 'object') return null
  if (!Array.isArray((raw as { sections?: unknown }).sections)) return null
  return raw as FormDocument
}

export function TaskScreen({
  task,
  onDone,
  onError,
  offline = false,
  me,
  onReleased,
  arrived = false,
  onArrivalSeen,
  active = false,
  surfaceColor,
}: TaskScreenProps) {
  const doc = asFormDocument(task.formDocument)
  const isYesNo = task.stepType === YES_NO
  const yesNoConfig = task.yesNoConfig as YesNoLabels | null

  const esig = doc ? findESignatureBlock(doc) : null
  // Spec §6: prefill the operator's own login name unless someone ELSE has to sign.
  const initialSignature = (): SignatureDraft => ({
    loginName: esig && !esig.requireDifferentUser ? (me?.loginName ?? '') : '',
    password: '',
  })
  const signatureHint = esig?.requireDifferentUser && me ? `Must be signed by someone other than ${me.displayName}` : null

  // Host obligation #1 (HOST-CONTRACT §1): seed `values` from literal defaults
  // before the renderer ever mounts — the renderer never resolves defaults itself.
  // Host obligation #2 (§2): the gate must be computed here at mount, before any
  // renderer event can arrive.
  // Spec §5.7 drafts: typed values come back after a reload, a tab switch or a
  // work-center switch — the seeded defaults first, the operator's own values on top.
  const [seed, setSeed] = useState<FormValues>(() => (doc ? seedDefaults(doc) : {}))
  const [values, setValues] = useState<FormValues>(() => ({
    ...seed,
    ...(doc ? (readDraft(task.assignmentId, task.stepInstanceId) ?? {}) : {}),
  }))
  const [signature, setSignature] = useState<SignatureDraft>(initialSignature)
  const [signatureError, setSignatureError] = useState<string | null>(null)
  const [gate, setGate] = useState<Gate>(() => gateFor(doc, values, signature))
  const [submitting, setSubmitting] = useState(false)
  const where = useWhereYouAre(task.instanceId, task.stepOid, active && !offline)
  const [whereOpen, setWhereOpen] = useState(false)

  // A paused step stays open — typed values are kept — but can't be acted on. The
  // work view feeds this component the LIVE task object, so `paused` clearing on
  // resume re-enables the buttons without any extra wiring.
  const locked = submitting || offline || task.paused

  // A new task (a different step INSTANCE) is not a remount of TaskScreen itself — it
  // arrives as a changed prop, mid-render — so field state and the gate are reset here
  // as a render-phase adjustment (React's documented "adjusting state when a prop
  // changes" pattern: https://react.dev/reference/react/useState#storing-information-from-previous-renders),
  // not a passive effect: an effect would commit one frame of the NEW instance's
  // chrome still showing the OLD instance's values and an unevaluated (stale-open)
  // gate, and would double-fire its resets under StrictMode's dev double-invoke of
  // effects. Calling the setters here, mid-render, makes React discard this render
  // and retry immediately with the new state — nothing stale ever commits.
  //
  // Keyed on `task.stepInstanceId` ONLY, deliberately not `doc`/task identity: the
  // Inbox snapshot is re-fetched on every SSE push / poll and yields a brand-new
  // object reference for the *same* step instance each time — resetting on that
  // identity change would silently wipe whatever the operator has already typed.
  const [seenInstance, setSeenInstance] = useState(task.stepInstanceId)
  if (seenInstance !== task.stepInstanceId) {
    const seeded = doc ? seedDefaults(doc) : {}
    const restored = { ...seeded, ...(doc ? (readDraft(task.assignmentId, task.stepInstanceId) ?? {}) : {}) }
    setSeenInstance(task.stepInstanceId)
    setSeed(seeded)
    setValues(restored)
    setSignature(initialSignature())
    setSignatureError(null)
    setGate(gateFor(doc, restored, initialSignature()))
    setSubmitting(false)
  }

  // Write-through on every change; an untouched form removes its draft. Keyed on the
  // values, not on `doc` — the snapshot hands over a new document object on every push.
  const hasDoc = doc !== null
  useEffect(() => {
    if (hasDoc) writeDraft(task.assignmentId, task.stepInstanceId, typedValues(values, seed))
  }, [hasDoc, task.assignmentId, task.stepInstanceId, values, seed])

  // Spec §6: a signature-bearing block never rides on the `decision no` path — the
  // No button walks away from the step without signing it.
  const signed = (body: SubmitBody): SubmitBody =>
    esig && body.kind !== 'complete' && !(body.kind === 'decision' && body.value === 'no') ? { ...body, signature } : body

  const submit = async (body: SubmitBody) => {
    setSubmitting(true)
    try {
      await api.submit(task.assignmentId, body)
      clearDraft(task.assignmentId)
      onDone()
    } catch (err) {
      if (err instanceof ApiError && err.code?.startsWith('SIGNATURE_')) {
        // Spec §6: the operator's form is intact — only the signature is wrong. Stay put.
        // The renderer only emits `validation` in response to its OWN events, never on a
        // prop change, so clearing the password here must also recompute the gate — otherwise
        // the button stays stale-enabled with an empty password.
        const cleared: SignatureDraft = { ...signature, password: '' }
        setSignatureError(signatureCopy(err))
        setSignature(cleared)
        setGate(gateFor(doc, values, cleared))
      } else if (err instanceof ApiError && (err.status === 403 || err.status === 409)) {
        onError(CHANGED_COPY, 'race')
      } else {
        console.error(err)
        onError(GENERIC_ERROR_COPY, 'other')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // Spec §5.4: Release from the task itself. A lost race (the claim is already gone)
  // closes the pane like a lost submit race; anything else leaves it open to retry.
  const release = async () => {
    setSubmitting(true)
    try {
      await api.release(task.assignmentId)
    } catch (err) {
      setSubmitting(false)
      if (err instanceof ApiError && (err.status === 403 || err.status === 409)) {
        onError(RELEASE_RACE_COPY, 'race')
      } else {
        console.error(err)
        onError(GENERIC_ERROR_COPY, 'other')
      }
      return
    }
    clearDraft(task.assignmentId)
    onReleased?.()
  }

  const decide = (value: 'yes' | 'no') => submit(signed({ kind: 'decision', value, values: doc ? values : undefined }))

  const onEvent = (e: FormEvent) => {
    switch (e.kind) {
      case 'fieldChange':
        setValues((v) => ({ ...v, [e.fieldName]: e.value }))
        break
      case 'signature':
        setSignature({ loginName: e.loginName, password: e.password })
        setSignatureError(null)
        break
      case 'validation':
        setGate({ ok: e.ok, missing: e.missing })
        break
      case 'action':
        // V1: an authored button is a submit trigger only when the gate already
        // passes and no submit is already in flight — same mapping as the Submit
        // chrome button, which disables itself on `submitting` for the same reason.
        if (gate.ok && !locked) submit(signed({ kind: 'submit', values }))
        break
      case 'job':
        // Spec 2026-10-28 §5.3: a job button presses the same action Pilot's own button would,
        // under exactly the same enabled rules — a job that doesn't fit this step does nothing.
        if (!jobEnabled[e.job]) break
        if (e.job === 'continue') submit(signed({ kind: 'submit', values }))
        else if (e.job === 'yes') decide('yes')
        else decide('no')
        break
      case 'timerState':
        console.debug(e)
        break
      default:
        break // complete/decision never come from the renderer — they are host chrome
    }
  }

  // Spec D5: No never requires (or sends) a signature — the gate's `missing` list may still
  // name the esignature block's fieldName while the draft is incomplete, but that's the ONLY
  // entry No is allowed to ignore. Any other missing required field still gates No exactly
  // as it does Yes/Submit.
  const noGateOk = gate.ok || (esig !== null && gate.missing.every((f) => f === esig.fieldName))
  // Single source for "may this job be pressed": drives both the rendered buttons and the
  // job event handler, so they can never disagree.
  const jobEnabled = {
    continue: !isYesNo && gate.ok && !locked,
    yes: isYesNo && gate.ok && !locked,
    no: isYesNo && noGateOk && !locked,
  }

  // Image src keys in a form_document are bare filenames; the bytes live in
  // workflow_image rows the engine serves per instance (frozen-recipe adjacent:
  // an instance's workflow row cannot be deleted while the instance exists).
  // useCallback keeps the reference stable across renders — FormDocumentView's
  // context invalidates on every new `images` identity (its own prop docs).
  const resolveImage = useCallback(
    (srcKey: string): string | undefined => {
      if (srcKey.startsWith('data:')) return srcKey
      // Designer's palette default for an image block never picked an upload —
      // there are no bytes anywhere for it (export skips it too), so keep the
      // renderer's placeholder instead of a URL that can only 404.
      if (srcKey === 'No image selected') return undefined
      return `/api/instances/${task.instanceId}/images/${encodeURIComponent(srcKey)}`
    },
    [task.instanceId],
  )

  // Spec §5.4: missing fields are links that jump to the field; a running timer is not
  // something to fill in, so it reads "Waiting for" instead (P0 minor). Only for
  // document-backed steps — the doc-less Continue has no gate. Ids are per assignment
  // because WorkView keeps every pane's TaskScreen mounted at once.
  const items = doc && !gate.ok ? missingItems(doc, gate.missing) : []
  const fields = items.filter((i) => i.kind !== 'timer')
  const timers = items.filter((i) => i.kind === 'timer')
  const missingId = items.length > 0 ? `missing-${task.assignmentId}` : undefined
  const ready = doc !== null && !isYesNo && gate.ok && !locked

  // Spec 2026-10-28 §5.3: a form that carries its own job buttons replaces Pilot's Continue/Yes/No —
  // unless they would leave the operator stuck on some device, in which case Pilot keeps its own.
  const stepKind = isYesNo ? 'yesno' : 'continue'
  const formOwnsButtons = useMemo(
    () => doc !== null && hasJobButtons(doc) && checkNeverStuck(doc, stepKind).length === 0,
    [doc, stepKind],
  )
  // The renderer draws the buttons; Pilot decides whether each may be pressed (same rules as its own).
  const buttonJobs: ButtonJobs = {
    continue: { enabled: jobEnabled.continue, label: task.continueLabel || 'Continue', describedBy: missingId },
    yes: { enabled: jobEnabled.yes, label: yesNoConfig?.yes_label ?? 'Yes', describedBy: !gate.ok ? missingId : undefined },
    no: { enabled: jobEnabled.no, label: yesNoConfig?.no_label ?? 'No', describedBy: !noGateOk ? missingId : undefined },
    signed: esig !== null,
  }

  const typedCount = doc ? Object.keys(typedValues(values, seed)).length : 0

  const rootRef = useRef<HTMLElement>(null)
  // The form's pinned bottom bar sits just above the action strip, whose height changes as the
  // status line wraps or the Release confirm opens, so measure it rather than guess.
  const actionsRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const root = rootRef.current
    const actions = actionsRef.current
    if (!formOwnsButtons || !root || !actions || typeof ResizeObserver === 'undefined') return
    const sync = () => root.style.setProperty('--task-actions-h', `${actions.offsetHeight}px`)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(actions)
    return () => ro.disconnect()
  }, [formOwnsButtons])
  const jumpTo = (item: MissingItem) => {
    const block = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [])].find(
      (el) => el.dataset.blockId === item.blockId,
    )
    if (!block) return
    block.scrollIntoView?.({ block: 'center' })
    ;(block.querySelector<HTMLElement>('input, select, textarea, button') ?? block).focus()
  }

  const missingBlock = missingId && (
    <div className="task-missing" id={missingId}>
      {fields.length > 0 && <MissingFields items={fields} onJump={jumpTo} />}
      {timers.length > 0 && <p className="task-waiting">Waiting for: {timers.map((t) => t.label).join(', ')}</p>}
    </div>
  )

  const primary = isYesNo ? (
    <>
      <button
        type="button"
        className="task-primary"
        disabled={!gate.ok || locked}
        aria-describedby={!gate.ok ? missingId : undefined}
        onClick={() => decide('yes')}
      >
        {esig ? signedLabel(yesNoConfig?.yes_label ?? 'Yes') : (yesNoConfig?.yes_label ?? 'Yes')}
      </button>
      <button
        type="button"
        className="task-primary"
        disabled={!noGateOk || locked}
        aria-describedby={!noGateOk ? missingId : undefined}
        onClick={() => decide('no')}
      >
        {yesNoConfig?.no_label ?? 'No'}
      </button>
    </>
  ) : doc ? (
    <button
      type="button"
      className="task-primary"
      disabled={!gate.ok || locked}
      aria-describedby={missingId}
      aria-keyshortcuts="Control+Enter"
      onClick={() => submit(signed({ kind: 'submit', values }))}
    >
      {esig ? signedLabel(task.continueLabel || 'Continue') : task.continueLabel || 'Continue'}
    </button>
  ) : (
    <button
      type="button"
      className="task-primary"
      disabled={locked}
      aria-keyshortcuts="Control+Enter"
      onClick={() => submit({ kind: 'complete' })}
    >
      {task.continueLabel || 'Continue'}
    </button>
  )

  // P4-R2: Ctrl+Enter presses the one primary button, only on the pane on screen and only
  // when that button is enabled. Never a Yes/No answer (two choices), never under the
  // Release question.
  const primaryAction = isYesNo
    ? null
    : doc
      ? gate.ok && !locked
        ? () => submit(signed({ kind: 'submit', values }))
        : null
      : !locked
        ? () => submit({ kind: 'complete' })
        : null
  useShortcut(
    'submit',
    primaryAction
      ? () => {
          if (rootRef.current?.querySelector('.release-confirm')) return
          // Workstation: the operator is working in the inbox column — typing in its filter,
          // or answering a Release question there — not on this task. Focus merely left on a
          // row's button (the task was just opened from it) still means this task.
          if (document.querySelector('.work-rail .release-confirm')) return
          if (document.activeElement?.closest('.work-rail input, .work-rail textarea, .work-rail select')) return
          primaryAction()
        }
      : null,
    active,
  )

  return (
    <main
      ref={rootRef}
      className={formOwnsButtons ? 'task-screen task-owns-buttons' : 'task-screen'}
      // Click, not pointer-down: dropping the banner moves everything below it up, and on
      // pointer-down that happened before the pointer came back up — the click then landed
      // on another element and the operator's first Continue/Approve was lost (P1d Task 1).
      // Keys target the focused element, not a screen position, so keydown is safe.
      onClickCapture={arrived ? onArrivalSeen : undefined}
      onKeyDownCapture={arrived ? onArrivalSeen : undefined}
    >
      {/* P1b Ruling 11 / P1c Ruling 4: the context bar shows step, workflow and runtime ID.
          The heading stays for screen readers and is where focus lands after a Submit. */}
      <h2 className="task-heading" id={`task-heading-${task.assignmentId}`} tabIndex={-1}>
        {task.stepName ?? task.stepOid}
      </h2>

      {arrived && (
        <p className="task-arrival" role="status">
          Now on: <strong>{task.stepName ?? task.stepOid}</strong> · <RuntimeId label={task.runtimeLabel} />
        </p>
      )}

      {task.paused && <p role="status">{PAUSED_COPY}</p>}

      {/* Below 1280 px the side panel is hidden and this opens it as a sheet (Ruling 5). */}
      <button type="button" className="where-toggle" aria-haspopup="dialog" onClick={() => setWhereOpen(true)}>
        Where you are
      </button>

      <div className="task-body">
        <div className="task-form">
          {doc && (
            <FormDocumentView
              key={task.stepInstanceId}
              document={doc}
              mode="run"
              values={values}
              images={resolveImage}
              onEvent={onEvent}
              signature={signature}
              signatureError={signatureError}
              signatureHint={signatureHint}
              surfaceColor={surfaceColor}
              buttonJobs={buttonJobs}
            />
          )}
        </div>
        <aside className="task-where">
          <WhereYouAre runtimeLabel={task.runtimeLabel} data={where} />
        </aside>
      </div>

      {whereOpen && (
        <Sheet label={`Where you are in ${task.runtimeLabel}`} onClose={() => setWhereOpen(false)}>
          <WhereYouAre runtimeLabel={task.runtimeLabel} data={where} showTitle={false} />
        </Sheet>
      )}

      {/* Spec §5.4: stays on screen at the bottom of the task (pilot.css). */}
      <footer ref={actionsRef} className={formOwnsButtons ? 'task-actions task-actions-compact' : 'task-actions'}>
        <div className="task-status">
          {missingBlock}
          {ready && <p className="task-ready">Ready to submit</p>}
        </div>
        <div className="task-buttons">
          <ReleaseButton typedCount={typedCount} disabled={submitting || offline} onRelease={release} />
          {!formOwnsButtons && primary}
        </div>
      </footer>
    </main>
  )
}
