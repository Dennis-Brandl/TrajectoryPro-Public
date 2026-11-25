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
import { TaskMenu, type TaskMenuItem } from '../task/TaskMenu'
import { ConnectionStatus } from './ConnectionStatus'
import { workflowParts } from './ContextBar'
import { Elide } from './Elide'
import { RuntimeId } from './RuntimeId'

export interface TaskAppBarProps {
  task: InboxTask
  back: { onBack(): void; disabled: boolean } | null
  onHome(): void
  connection: { online: boolean; stale: boolean; unreachable: boolean; syncedAt: Date | null }
  menu: TaskMenuItem[]
}

// Phone layout: one compact bar replaces the top bar, tab strip, context bar and task line
// while a task is open. Line 1 is the runtime ID and workflow, line 2 the step.
export function TaskAppBar({ task, back, onHome, connection, menu }: TaskAppBarProps) {
  const [wfHead, wfTail] = workflowParts(task)
  const showStatus = !connection.online || connection.stale || connection.unreachable
  return (
    <header className="task-app-bar">
      {back && (
        <button type="button" className="task-app-back" aria-label="Back" disabled={back.disabled} onClick={back.onBack}>
          ←
        </button>
      )}
      <div className="task-app-title">
        <div className="task-app-line1">
          <RuntimeId label={task.runtimeLabel} />
          <span className="sep">{' · '}</span>
          <Elide head={wfHead} tail={wfTail} />
        </div>
        <div className="task-app-line2">{task.stepName ?? task.stepOid}</div>
      </div>
      {showStatus && <ConnectionStatus {...connection} />}
      <button type="button" className="task-app-home" aria-label="Inbox" onClick={onHome}>
        ⌂
      </button>
      <TaskMenu items={menu} />
    </header>
  )
}
