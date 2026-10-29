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

import type { Finding } from '../../../server/admin/cleanup/types'

interface Props {
  finding: Finding
  checked: boolean
  onToggle: (findingId: string, checked: boolean) => void
}

const DRIFT_LABEL: Record<Finding['driftType'], string> = {
  D1: 'Orphan embedded child',
  D2: 'Re-parented embedded child',
  D3: 'Stale proxy_reference',
  D4: 'Missing proxy_reference',
  D5: 'Dangling embedded target',
  D6: 'Dangling reference target',
}

function describeFinding(f: Finding): string {
  switch (f.driftType) {
    case 'D1':
      return `"${f.orphanSpecName}" (${f.orphanSpecId}) +${f.descendantCount} descendants`
    case 'D2':
      return `"${f.childSpecName}" — DB parent ${f.dbParentId ?? '(none)'} → diagram parent ${f.diagramParentId}`
    case 'D3':
      return `row parent=${f.parentSpecId} node=${f.nodeId} target=${f.targetSpecId}`
    case 'D4':
      return `row parent=${f.parentSpecId} node=${f.nodeId} target=${f.targetSpecId}`
    case 'D5':
      return `parent=${f.parentSpecId} node=${f.nodeId} → missing ${f.missingTargetId}`
    case 'D6':
      return `parent=${f.parentSpecId} node=${f.nodeId} → missing ${f.missingTargetId}`
  }
}

const DESTRUCTIVE: Finding['driftType'][] = ['D1', 'D2']
const REPORT_ONLY: Finding['driftType'][] = ['D5', 'D6']

export function FindingRow({ finding, checked, onToggle }: Props) {
  const destructive = DESTRUCTIVE.includes(finding.driftType)
  const reportOnly = REPORT_ONLY.includes(finding.driftType)

  return (
    <div
      className={`flex items-start gap-3 px-3 py-2 border-b border-slate-200 dark:border-slate-700 last:border-b-0 ${
        destructive
          ? 'bg-amber-50 dark:bg-amber-950/30'
          : reportOnly
            ? 'bg-slate-50 dark:bg-slate-800/60'
            : 'bg-white dark:bg-slate-900'
      }`}
    >
      {reportOnly ? (
        <span className="mt-0.5 inline-block w-4 h-4 text-center text-slate-400 dark:text-slate-500 text-xs">—</span>
      ) : (
        <input
          type="checkbox"
          className="mt-1 accent-blue-600 dark:accent-blue-400"
          checked={checked}
          onChange={(e) => onToggle(finding.id, e.target.checked)}
          aria-label={`Apply ${finding.id}`}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{finding.driftType}</span>
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {DRIFT_LABEL[finding.driftType]}
          </span>
          {destructive && <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">Destructive</span>}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono break-all">{describeFinding(finding)}</div>
        {reportOnly && (
          <div className="text-xs text-slate-500 dark:text-slate-400 italic mt-0.5">
            Cannot auto-fix — manual review required.
          </div>
        )}
      </div>
    </div>
  )
}
