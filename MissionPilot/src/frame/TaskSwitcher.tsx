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

import { useState, type CSSProperties } from 'react'
import type { InboxTask } from '../api/types'
import { OpenClaimsSheet } from './OpenClaimsSheet'
import { instanceStripe } from './runtime-id'

export interface TaskSwitcherProps {
  tasks: InboxTask[]
  focusedId: string
  onPick(assignmentId: string): void
}

// Phone: a slim row under the task app bar when two or more tasks are open. Previous / next
// step through the claims, wrapping at the ends; the middle button lists them all in the "Open tasks" sheet.
export function TaskSwitcher({ tasks, focusedId, onPick }: TaskSwitcherProps) {
  const [open, setOpen] = useState(false)
  const index = tasks.findIndex((t) => t.assignmentId === focusedId)
  if (tasks.length < 2) return null
  const current = tasks[index]
  if (!current) return null
  const step = current.stepName ?? current.stepOid
  const pos = `${index + 1} of ${tasks.length}`
  // ‹/› wrap around (user 2026-11-25): first ‹ goes to the last task, last › to the first.
  const at = (i: number) => tasks[(i + tasks.length) % tasks.length]!.assignmentId
  return (
    <div
      className="task-switcher"
      style={{ '--tab-stripe': `var(--pilot-instance-${instanceStripe(current.runtimeLabel)})` } as CSSProperties}
    >
      <button
        type="button"
        aria-label="Previous task"
        onClick={() => onPick(at(index - 1))}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label={`Open tasks: ${step}, ${pos}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {`${step} · ${pos}`}
      </button>
      <button
        type="button"
        aria-label="Next task"
        onClick={() => onPick(at(index + 1))}
      >
        ›
      </button>
      {open && (
        <OpenClaimsSheet
          tasks={tasks}
          focusedId={focusedId}
          onPick={(id) => {
            setOpen(false)
            onPick(id)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
