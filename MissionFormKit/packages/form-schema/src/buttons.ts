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
import type { ButtonBlock, ButtonJob, FormDocument, StepKind } from './types'
import { BREAKPOINT_KEYS, resolveAt, type BreakpointKey } from './resolve'

export const JOB_DEFAULT_LABEL: Record<ButtonJob, string> = { continue: 'Continue', yes: 'Yes', no: 'No' }

/** The v1 convention, so continueLabelOf and old readers keep working. */
export const JOB_OUTPUT_VALUE: Record<ButtonJob, string> = { continue: 'continue', yes: 'true', no: 'false' }

const BREAKPOINT_NAME: Record<BreakpointKey, string> = { base: 'Desktop', tablet: 'Tablet', phone: 'Phone' }

/** Buttons that have a job, in document order across all sections. */
export function jobButtons(doc: FormDocument): ButtonBlock[] {
  const out: ButtonBlock[] = []
  for (const section of doc.sections) {
    for (const row of section.rows) {
      for (const block of row.blocks) {
        if (block.type === 'button' && block.job) out.push(block)
      }
    }
  }
  return out
}

export function hasJobButtons(doc: FormDocument): boolean {
  return jobButtons(doc).length > 0
}

export interface StuckProblem {
  /** null = applies to the whole form rather than one device. */
  breakpoint: BreakpointKey | null
  blockId?: string
  message: string
}

/**
 * The never-stuck check: for a form with job buttons, every breakpoint must show
 * the buttons the step needs, and no button may carry a job the step cannot use.
 */
export function checkNeverStuck(doc: FormDocument, stepKind: StepKind): StuckProblem[] {
  const buttons = jobButtons(doc)
  if (buttons.length === 0) return []
  const problems: StuckProblem[] = []
  const required: ButtonJob[] = stepKind === 'continue' ? ['continue'] : ['yes', 'no']

  for (const b of buttons) {
    const job = b.job as ButtonJob
    if (required.includes(job)) continue
    problems.push({
      breakpoint: null,
      blockId: b.id,
      message:
        job === 'continue'
          ? 'A Continue button does not work on a Yes/No step — use Yes and No.'
          : `A ${JOB_DEFAULT_LABEL[job]} button only works on a Yes/No step.`,
    })
  }

  for (const bp of BREAKPOINT_KEYS) {
    for (const job of required) {
      const shown = buttons.some((b) => b.job === job && resolveAt(b.layout?.visible, bp, true))
      if (shown) continue
      problems.push({
        breakpoint: bp,
        message:
          job === 'continue'
            ? `No Continue button is visible on ${BREAKPOINT_NAME[bp]}.`
            : `No "${JOB_DEFAULT_LABEL[job]}" button is visible on ${BREAKPOINT_NAME[bp]}.`,
      })
    }
  }
  return problems
}
