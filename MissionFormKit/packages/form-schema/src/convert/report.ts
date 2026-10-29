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

/** One lossy or ambiguous conversion event. Advisory — conversion never throws for these. */
export type ConversionEntryKind =
  | 'legacyRescale'
  | 'spanRounding'
  | 'oversizedImage'
  | 'fontSizeLost'
  | 'droppedDefaultButton'
  | 'droppedYesNoButtons'
  | 'phoneOrderDivergence'

export interface ConversionEntry {
  kind: ConversionEntryKind
  /** The v1 element id this concerns, when applicable. */
  blockId?: string
  /** Human-readable; for droppedYesNoButtons carries the preserved labels. */
  detail: string
  /** droppedYesNoButtons only: the dropped pair's labels, structured for hosts that
   *  preserve them into step config (Designer's migration/import → uiParameters). */
  yesNoLabels?: { yes: string; no: string }
}

export interface ConversionReport {
  entries: ConversionEntry[]
}
