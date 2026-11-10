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
import { BREAKPOINT_KEYS, resolveAt, type BreakpointKey } from './resolve'
import { JOB_OUTPUT_VALUE } from './buttons'
import { convertButtons } from './convert-buttons'
import type { ButtonBlock, ButtonJob, FormDocument, GridSpan, Section, StepKind } from './types'

/**
 * The form as a host runs it (user ruling 2026-11-10): the form's own button is the step's ONE
 * button — Mission Pilot (and Designer's preview) draw no buttons of their own. So:
 *  - a button without a job becomes the step's button (every button is Continue on a User
 *    Interaction step; "true"/"false" ones are Yes/No on a Yes/No step) — convertButtons;
 *  - a step with no such button gets one, centered, on a new bottom row (a step with no form
 *    at all gets just that row);
 *  - a device on which the form hides its button gets a centered one that only that device shows,
 *    so no screen type ever leaves the operator without a way on.
 * Ids are fixed (`pilot-…`), so the same form always comes out the same.
 */
export function withStepButtons(doc: FormDocument | null, stepKind: StepKind): FormDocument {
  let n = 0
  const newId = () => `pilot-step-button-${++n}`
  const { document: converted } = convertButtons(doc ?? { version: 2, sections: [] }, stepKind, newId)

  const required: ButtonJob[] = stepKind === 'continue' ? ['continue'] : ['yes', 'no']
  const buttons: ButtonBlock[] = []
  for (const s of converted.sections)
    for (const r of s.rows) for (const b of r.blocks) if (b.type === 'button' && b.job) buttons.push(b)

  // Per job, the devices on which no button with that job shows.
  const hiddenOn = new Map<ButtonJob, Set<BreakpointKey>>()
  for (const job of required) {
    const bps = BREAKPOINT_KEYS.filter(
      (bp) => !buttons.some((b) => b.job === job && resolveAt(b.layout?.visible, bp, true)),
    )
    if (bps.length > 0) hiddenOn.set(job, new Set(bps))
  }
  if (hiddenOn.size === 0) return converted

  const jobs = [...hiddenOn.keys()]
  const span = (12 / jobs.length) as GridSpan
  const row = {
    id: newId(),
    blocks: jobs.map((job): ButtonBlock => {
      const on = hiddenOn.get(job)!
      return {
        id: newId(),
        type: 'button',
        layout: {
          span: { base: span },
          align: 'center',
          visible: { base: on.has('base'), tablet: on.has('tablet'), phone: on.has('phone') },
        },
        job,
        label: '',
        outputValue: JOB_OUTPUT_VALUE[job],
        emphasis: 'primary',
      }
    }),
  }
  const footerAt = converted.sections.findIndex((s) => s.role === 'footer')
  const footer: Section = converted.sections[footerAt] ?? { id: newId(), role: 'footer', rows: [] }
  const nextFooter: Section = { ...footer, rows: [...footer.rows, row] }
  return {
    ...converted,
    sections:
      footerAt >= 0
        ? converted.sections.map((s, i) => (i === footerAt ? nextFooter : s))
        : [...converted.sections, nextFooter],
  }
}
