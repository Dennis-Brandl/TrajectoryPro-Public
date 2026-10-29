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
import type { ButtonBlock, ButtonJob, FormDocument, Row, Section, StepKind } from './types'
import { JOB_DEFAULT_LABEL, JOB_OUTPUT_VALUE, checkNeverStuck, type StuckProblem } from './buttons'

export interface ConvertButtonsResult {
  /** The SAME reference when nothing changed. */
  document: FormDocument
  changed: boolean
  /** One human sentence per change. */
  changes: string[]
  /** Block ids left job-less (spec 5.5). */
  needsJob: string[]
  /** checkNeverStuck on the result. */
  problems: StuckProblem[]
}

const JOB_NAME: Record<ButtonJob, string> = { continue: 'Continue', yes: 'Yes', no: 'No' }

function jobFor(button: ButtonBlock, stepKind: StepKind): ButtonJob | null {
  if (stepKind === 'continue') return 'continue'
  if (button.outputValue === JOB_OUTPUT_VALUE.yes) return 'yes'
  if (button.outputValue === JOB_OUTPUT_VALUE.no) return 'no'
  return null
}

/**
 * Moves an existing form onto job buttons: gives job-less buttons a job where the
 * mapping is unambiguous, then adds any button the step still needs to the bottom bar.
 */
export function convertButtons(doc: FormDocument, stepKind: StepKind, newId: () => string): ConvertButtonsResult {
  const changes: string[] = []
  const needsJob: string[] = []
  let mapped = false

  const sections: Section[] = doc.sections.map((section) => {
    let sectionChanged = false
    const rows = section.rows.map((row) => {
      let rowChanged = false
      const blocks = row.blocks.map((block) => {
        if (block.type !== 'button' || block.job) return block
        const job = jobFor(block, stepKind)
        const shown = block.label.trim() !== '' ? block.label : block.outputValue
        if (!job) {
          needsJob.push(block.id)
          changes.push(`Button "${shown}" needs a job — pick Yes or No.`)
          return block
        }
        const next: ButtonBlock = { ...block, job, outputValue: JOB_OUTPUT_VALUE[job] }
        if (block.label === JOB_DEFAULT_LABEL[job]) next.label = ''
        changes.push(`Button "${block.label.trim() !== '' ? block.label : JOB_DEFAULT_LABEL[job]}" is now a ${JOB_NAME[job]} button.`)
        rowChanged = true
        return next
      })
      if (!rowChanged) return row
      sectionChanged = true
      return { ...row, blocks }
    })
    if (!sectionChanged) return section
    mapped = true
    return { ...section, rows }
  })

  let result: FormDocument = mapped ? { ...doc, sections } : doc

  const present = new Set<ButtonJob>()
  for (const s of result.sections)
    for (const r of s.rows)
      for (const b of r.blocks) if (b.type === 'button' && b.job) present.add(b.job)
  const required: ButtonJob[] = stepKind === 'continue' ? ['continue'] : ['yes', 'no']
  const missing = required.filter((j) => !present.has(j))

  if (missing.length > 0) {
    const footerIndex = result.sections.findIndex((s) => s.role === 'footer')
    const footer: Section = result.sections[footerIndex] ?? { id: newId(), role: 'footer', rows: [] }
    const row: Row = {
      id: newId(),
      blocks: missing.map(
        (job): ButtonBlock => ({
          id: newId(),
          type: 'button',
          job,
          label: '',
          outputValue: JOB_OUTPUT_VALUE[job],
          emphasis: 'primary',
        }),
      ),
    }
    const newFooter: Section = { ...footer, rows: [...footer.rows, row] }
    const nextSections =
      footerIndex >= 0
        ? result.sections.map((s, i) => (i === footerIndex ? newFooter : s))
        : [...result.sections, newFooter]
    result = { ...result, sections: nextSections }
    for (const job of missing) changes.push(`Added a ${JOB_NAME[job]} button to the bottom bar.`)
  }

  return {
    document: result,
    changed: result !== doc,
    changes,
    needsJob,
    problems: checkNeverStuck(result, stepKind),
  }
}
