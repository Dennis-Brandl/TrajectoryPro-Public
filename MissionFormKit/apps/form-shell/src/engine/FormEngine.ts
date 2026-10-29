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
import type { FormDocument, FormValues } from '@mission/form-schema'

/** The renderer's action event, minus the discriminant. */
export type ActionEvent = { blockId: string; outputValue: string }

/**
 * One step execution dispatched by the engine.
 *
 * `screenId` identifies the STEP. `instanceId` identifies THIS EXECUTION of it, and
 * is unique across the flow — a step entered twice yields two instanceIds.
 *
 * The host keys the renderer on `instanceId`, and that is load-bearing: workflows
 * contain loops, so the same step repeats and each instance must start fresh
 * (`docs/HOST-CONTRACT.md` §3-§4). Keying on `screenId` would leave a self-loop
 * (step -> itself) with an unchanged key, so React would not remount and the
 * renderer's settled-timer state would carry into the next instance — skipping its
 * cure. The engine mints the id so a host cannot get this wrong by inventing one.
 */
export interface ScreenTransition {
  kind: 'screen'
  screenId: string
  instanceId: string
  document: FormDocument
  /**
   * Field values the host should adopt on entry: carried forward when advancing,
   * and the restored snapshot when stepping back.
   */
  values: FormValues
}

export type Transition = ScreenTransition | { kind: 'complete' }

/**
 * The workflow-execution seam.
 *
 * The engine owns navigation — position, history, and instance identity. The host
 * renders what it is handed and reports events back. This mirrors the target
 * architecture, where a separate app executes the workflow and the UI-host only
 * displays it: navigation is execution, so it belongs here rather than in a
 * host-owned back-stack.
 *
 * Deliberately app-local. Execution is meaningless in the Designer editor, so nothing
 * in this seam may leak into the `form-schema`/`form-renderer` packages Designer
 * consumes. The renderer stays execution-agnostic: it receives `instanceId` only as
 * React's `key`, which is not part of its props.
 */
export interface FormEngine {
  /** Enter the flow at its entry step, resetting position. Always a screen for a well-formed flow. */
  start(): Transition
  /** Advance from the current step. `values` is snapshotted so a later `back()` can restore it. */
  next(values: FormValues, action: ActionEvent): Transition
  /** Re-enter the previous step as a NEW instance. Null when there is nowhere to go back to. */
  back(): ScreenTransition | null
  /** Whether `back()` would return a screen. */
  canGoBack(): boolean
  /** 1-based position in the flow, for host chrome. Counts entries, so a loop advances it. */
  step(): number
}
