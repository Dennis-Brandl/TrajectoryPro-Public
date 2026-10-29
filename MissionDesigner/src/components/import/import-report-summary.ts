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

import type { PostImportReport, ReplaceRefusalReason } from '@/types/wflibx-import'

/** The preview/report wording for a refused Replace (spec 2026-10-21 §6 — verbatim). */
export const REFUSAL_LABEL: Record<ReplaceRefusalReason, string> = {
  locked: 'Released — will not be replaced',
  'no-permission': 'No permission to replace',
  'changed-since-export': 'Changed here since export — will not be changed',
}

/** What differs for a changed-since-export row, e.g. "File: Effective · Here: Obsolete · Effective here: v3.0.0". */
export function changedSinceExportDetail(d: {
  fileVersion: string
  fileState: string
  version: string
  state: string
  effectiveVersionHere?: string
}): string {
  const file = d.fileVersion === d.version ? d.fileState : `v${d.fileVersion} ${d.fileState}`.trim()
  const here = d.fileVersion === d.version ? d.state : `v${d.version} ${d.state}`
  const parts = [`File: ${file || 'no state'}`, `Here: ${here}`]
  if (d.effectiveVersionHere !== undefined) parts.push(`Effective here: v${d.effectiveVersionHere}`)
  return parts.join(' · ')
}

/** The success toast after a .WFlibX commit; adds ", N refused" only when some were. */
export function importToastMessage(bundleLibraryName: string, report: PostImportReport): string {
  const created = report.created.libraries + report.created.specifications
  const replaced = report.replaced.libraries + report.replaced.specifications
  const refused = report.refused.length
  const tail = refused > 0 ? `, ${refused} refused` : ''
  return `Imported "${bundleLibraryName}" — ${created} created, ${replaced} replaced${tail}`
}

/** The post-import report opens for refused Replaces or broken references. */
export function needsImportReport(report: PostImportReport): boolean {
  return report.refused.length > 0 || report.danglingReferences.length > 0
}
