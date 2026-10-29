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
import { useState } from 'react'
import type { FormDocument, FormEvent, FormValues, SignatureDraft } from '@mission/form-schema'
import { computeValidation } from '@mission/form-schema'
import type { ActionEvent, FormEngine, ScreenTransition, Transition } from '../engine/FormEngine'

const EMPTY_TIMERS: ReadonlySet<string> = new Set()
/** Fresh e-signature draft for a freshly-entered screen. See HOST-CONTRACT.md §2 rule 4. */
const EMPTY_DRAFT: SignatureDraft = { loginName: '', password: '' }

interface Screen {
  screenId: string
  /** Renderer remount key — unique per step ENTRY. See FormEngine.ScreenTransition. */
  instanceId: string
  document: FormDocument
}

interface Gate {
  ok: boolean
  missing: string[]
}

/** Engine position, mirrored at each transition so render never reads the engine. */
interface Position {
  step: number
  canGoBack: boolean
}

export interface FlowHostState {
  current: Screen
  values: FormValues
  /** Host-owned e-signature draft. Never part of `values` (spec 2026-09-06 D3). */
  signature: SignatureDraft
  gate: Gate
  done: boolean
  log: string[]
  step: number
  canGoBack: boolean
  onEvent: (e: FormEvent) => void
  back: () => void
  restart: () => void
}

function entryScreen(engine: FormEngine): Screen {
  const t = engine.start()
  if (t.kind !== 'screen') {
    throw new Error('useFlowHost: flow entry must be a screen, got complete')
  }
  return { screenId: t.screenId, instanceId: t.instanceId, document: t.document }
}

export function useFlowHost(engine: FormEngine): FlowHostState {
  const [current, setCurrent] = useState<Screen>(() => entryScreen(engine))
  const [values, setValues] = useState<FormValues>({})
  const [signature, setSignature] = useState<SignatureDraft>(EMPTY_DRAFT)
  const [gate, setGate] = useState<Gate>(() => computeValidation(current.document, {}, EMPTY_TIMERS, EMPTY_DRAFT))
  const [position, setPosition] = useState<Position>(() => ({
    step: engine.step(),
    canGoBack: engine.canGoBack(),
  }))
  const [done, setDone] = useState(false)
  const [log, setLog] = useState<string[]>([])

  const pushLog = (obj: unknown) => setLog((l) => [JSON.stringify(obj), ...l].slice(0, 30))

  const syncPosition = () => setPosition({ step: engine.step(), canGoBack: engine.canGoBack() })

  /**
   * Adopt a step the engine dispatched. The renderer emits no validation on mount
   * (docs/HOST-CONTRACT.md §2), so the gate is computed here; the empty timer set is
   * correct because `instanceId` changes on every entry and forces a remount (§3).
   */
  const applyScreen = (t: ScreenTransition) => {
    setCurrent({ screenId: t.screenId, instanceId: t.instanceId, document: t.document })
    setValues(t.values)
    // A fresh screen instance never inherits the previous instance's e-signature draft.
    setSignature(EMPTY_DRAFT)
    setGate(computeValidation(t.document, t.values, EMPTY_TIMERS, EMPTY_DRAFT))
    syncPosition()
    setDone(false)
  }

  const advance = (action: ActionEvent) => {
    if (!gate.ok) return // blocked; StepBar already surfaces gate.missing
    pushLog({ kind: 'decision', value: action.outputValue }) // host chrome, not the renderer
    let t: Transition
    try {
      t = engine.next(values, action)
    } catch (err) {
      pushLog({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      return
    }
    if (t.kind === 'complete') {
      pushLog({ kind: 'complete' }) // host chrome, not the renderer
      setDone(true)
      syncPosition()
    } else {
      applyScreen(t)
    }
  }

  const onEvent = (e: FormEvent) => {
    pushLog(e)
    switch (e.kind) {
      case 'fieldChange':
        setValues((v) => ({ ...v, [e.fieldName]: e.value }))
        break
      case 'signature':
        setSignature({ loginName: e.loginName, password: e.password })
        break
      case 'validation':
        setGate({ ok: e.ok, missing: e.missing })
        break
      case 'action':
        advance({ blockId: e.blockId, outputValue: e.outputValue })
        break
      default:
        break // timerState logged only; complete/decision never come from the renderer
    }
  }

  const back = () => {
    const t = engine.back()
    if (!t) return
    applyScreen(t)
  }

  const restart = () => {
    const entry = entryScreen(engine)
    setCurrent(entry)
    setValues({})
    setSignature(EMPTY_DRAFT)
    setGate(computeValidation(entry.document, {}, EMPTY_TIMERS, EMPTY_DRAFT))
    syncPosition()
    setDone(false)
    setLog([])
  }

  return {
    current,
    values,
    signature,
    gate,
    done,
    log,
    step: position.step,
    canGoBack: position.canGoBack,
    onEvent,
    back,
    restart,
  }
}
