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
import { JOB_OUTPUT_VALUE } from './buttons'
import { BREAKPOINT_KEYS, resolveAt, type BreakpointKey } from './resolve'
import type { Block, FormDocument, OptionEntry, StepKind } from './types'

/**
 * Checks an authoring tool runs before a form goes out (user rulings 2026-11-14). Each returns
 * one entry per problem, with a sentence an author can act on. Pure and React-free.
 */
export interface AuthoringProblem {
  blockId: string
  message: string
}

const SCREEN_NAME: Record<BreakpointKey, string> = { base: 'Desktop', tablet: 'Tablet', phone: 'Phone' }

function allBlocks(doc: FormDocument): Block[] {
  return doc.sections.flatMap((s) => s.rows.flatMap((r) => r.blocks))
}

function nameOf(block: Block): string {
  const label = 'label' in block && typeof block.label === 'string' ? block.label.trim() : ''
  if (label) return `"${label}"`
  return 'fieldName' in block && block.fieldName ? `"${block.fieldName}"` : `"${block.id}"`
}

/**
 * A block the step cannot complete without — a required input, or a timer that must finish —
 * hidden on a screen type. The operator on that screen could never complete the step.
 */
export function findHiddenRequired(doc: FormDocument): AuthoringProblem[] {
  const problems: AuthoringProblem[] = []
  for (const block of allBlocks(doc)) {
    const required =
      ((block.type === 'textInput' || block.type === 'textarea' || block.type === 'checkbox' || block.type === 'radio') &&
        block.required === true) ||
      (block.type === 'timer' && block.blockDone === true)
    if (!required) continue
    const hiddenOn = BREAKPOINT_KEYS.filter((bp) => !resolveAt(block.layout?.visible, bp, true))
    if (hiddenOn.length === 0) continue
    const what = block.type === 'timer' ? 'must finish before the step completes' : 'is required'
    problems.push({
      blockId: block.id,
      message: `${nameOf(block)} ${what} but is hidden on ${hiddenOn.map((bp) => SCREEN_NAME[bp]).join(' and ')} — show it there or make it optional.`,
    })
  }
  return problems
}

/**
 * Two options of one list with the same value: radio buttons would both show as chosen and
 * checkboxes would tick together. Lists filled from an input parameter are not checked here
 * (the server drops their later duplicates).
 */
export function findDuplicateOptionValues(doc: FormDocument): AuthoringProblem[] {
  const problems: AuthoringProblem[] = []
  for (const block of allBlocks(doc)) {
    let list: OptionEntry[] | undefined
    if (block.type === 'checkbox' || block.type === 'radio') list = block.options
    else if (block.type === 'textInput') list = block.listItems
    if (!list || ('listSource' in block && block.listSource?.mode === 'input')) continue
    const seen = new Set<string>()
    const reported = new Set<string>()
    for (const option of list) {
      if (seen.has(option.value) && !reported.has(option.value)) {
        reported.add(option.value)
        problems.push({
          blockId: block.id,
          message: `${nameOf(block)} has more than one option with the value "${option.value}" — each option needs its own value.`,
        })
      }
      seen.add(option.value)
    }
  }
  return problems
}

/**
 * On a Yes/No step, a button with no job answers nothing: only buttons whose value is the old
 * `true`/`false` convention are taken as Yes/No. Any other job-less button must be given a job.
 * (On a Continue step every button becomes Continue, so nothing is reported.)
 */
export function checkJoblessButtons(doc: FormDocument, stepKind: StepKind): AuthoringProblem[] {
  if (stepKind !== 'yesno') return []
  const problems: AuthoringProblem[] = []
  for (const block of allBlocks(doc)) {
    if (block.type !== 'button' || block.job) continue
    if (block.outputValue === JOB_OUTPUT_VALUE.yes || block.outputValue === JOB_OUTPUT_VALUE.no) continue
    const shown = block.label.trim() !== '' ? block.label : block.outputValue
    problems.push({ blockId: block.id, message: `Button "${shown}" needs a job — pick Yes or No.` })
  }
  return problems
}
