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
import type { ConversionReport, FormDocument, V1FormLayouts } from '@mission/form-schema'
import { convertFormLayouts } from '@mission/form-schema'

export interface ConvertedLayouts {
  document: FormDocument
  report: ConversionReport
  /** Present when the converter dropped a locked Yes/No footer pair — the operator-visible
   *  v1 form labels, to be upserted into the step's uiParameters (design §9.1). */
  yesNoLabels?: { yes: string; no: string }
}

/**
 * The ONE Designer entry point over FormKit's v1→v2 converter — used by legacy (≤4.0)
 * package import and the boot migration. (P4.2 Task 5 deleted the v1 editor tree,
 * including the sync-write `save-payload.ts` that used to also call this.)
 */
export function convertV1FormLayouts(layouts: V1FormLayouts): ConvertedLayouts {
  const { document, report } = convertFormLayouts(layouts)
  const entry = report.entries.find((e) => e.kind === 'droppedYesNoButtons')
  return { document, report, ...(entry?.yesNoLabels ? { yesNoLabels: entry.yesNoLabels } : {}) }
}
