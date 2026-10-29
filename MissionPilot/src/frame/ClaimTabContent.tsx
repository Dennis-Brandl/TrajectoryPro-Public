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
import { taskLabel } from '../task-label'
import { RuntimeId } from './RuntimeId'

/** The tab's accessible name: the full runtime ID always, plus workflow and paused state (spec §4, §5.2). */
export function claimTabName(t: InboxTask): string {
  return `${taskLabel(t)} · ${t.masterName}${t.paused ? ' · Paused' : ''}`
}

// Spec §5.2: line 1 the step, line 2 the runtime ID (mono, last segment bold) · workflow.
// Line 2 always carries the workflow name, so two open tabs that share a step name are
// already told apart there — no separate third line.
export function ClaimTabContent({ task }: { task: InboxTask }) {
  return (
    <>
      <span className="claim-tab-step">{task.stepName ?? task.stepOid}</span>
      <span className="claim-tab-meta">
        <RuntimeId label={task.runtimeLabel} />
        <span className="claim-tab-wf">
          <span className="sep"> · </span>
          {task.masterName}
        </span>
      </span>
      {task.paused && (
        <span className="work-tab-badge">
          <span aria-hidden="true">❚❚ </span>Paused
        </span>
      )}
    </>
  )
}
