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

import type { InboxTask } from '../api/types'
import { RuntimeId } from './RuntimeId'
import { Sheet } from './Sheet'

export interface OpenClaimsSheetProps {
  tasks: InboxTask[]
  focusedId: string | null
  onPick(assignmentId: string): void
  onClose(): void
}

// Spec §5.2, tablet portrait: once the tabs scroll out of reach, "N open" lists every claim
// with step, runtime ID, workflow and paused state; picking one jumps to its tab.
export function OpenClaimsSheet({ tasks, focusedId, onPick, onClose }: OpenClaimsSheetProps) {
  return (
    <Sheet label="Open tasks" onClose={onClose}>
      <ul>
        {tasks.map((t) => (
          <li key={t.assignmentId}>
            <button
              type="button"
              className="claims-sheet-item"
              aria-current={t.assignmentId === focusedId ? 'true' : undefined}
              onClick={() => onPick(t.assignmentId)}
            >
              <span className="claim-tab-step">{t.stepName ?? t.stepOid}</span>
              <span className="claim-tab-meta">
                <RuntimeId label={t.runtimeLabel} />
                <span className="claim-tab-wf">
                  <span className="sep"> · </span>
                  {t.masterName}
                </span>
              </span>
              {t.paused && <span className="work-tab-badge">Paused</span>}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
