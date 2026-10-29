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
import type { V1Element } from './v1-types'
import type { ConversionEntry } from './report'

export function isButtonRow(row: V1Element[]): boolean {
  return row.length > 0 && row.every((e) => e.type === 'button')
}

export function splitTrailingButtonRows(rows: V1Element[][]): { contentRows: V1Element[][]; trailingButtons: V1Element[] } {
  let cut = rows.length
  while (cut > 0 && isButtonRow(rows[cut - 1]!)) cut--
  const contentRows = rows.slice(0, cut)
  const trailingButtons = rows.slice(cut).flat()
  return { contentRows, trailingButtons }
}

function isDefaultContinue(b: V1Element): boolean {
  return b.deletable === false && b.outputValue === 'continue' && b.label === 'Continue'
}

export function classifyFooter(trailingButtons: V1Element[], entries: ConversionEntry[]): V1Element[] {
  // Yes/No pair: exactly two locked buttons routing true/false.
  if (trailingButtons.length === 2 && trailingButtons.every((b) => b.deletable === false)) {
    const values = new Set(trailingButtons.map((b) => b.outputValue))
    if (values.has('true') && values.has('false')) {
      const yes = trailingButtons.find((b) => b.outputValue === 'true')!
      const no = trailingButtons.find((b) => b.outputValue === 'false')!
      entries.push({
        kind: 'droppedYesNoButtons',
        detail: `dropped Yes/No buttons; preserved labels yes="${yes.label ?? ''}" no="${no.label ?? ''}"`,
        yesNoLabels: { yes: yes.label ?? '', no: no.label ?? '' },
      })
      return []
    }
  }

  const kept: V1Element[] = []
  for (const b of trailingButtons) {
    if (isDefaultContinue(b)) {
      entries.push({ kind: 'droppedDefaultButton', blockId: b.id, detail: 'dropped default Continue button (completion is UI-host chrome in v2)' })
      continue
    }
    kept.push(b)
  }
  return kept
}
