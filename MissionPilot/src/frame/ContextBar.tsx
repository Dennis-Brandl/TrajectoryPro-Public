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

import { useEffect, useRef, useState } from 'react'
import type { InboxTask } from '../api/types'
import { Elide } from './Elide'
import { RuntimeId } from './RuntimeId'
import { useShortcut } from './shortcuts'

export interface ContextBarProps {
  task: InboxTask
  wcName: string
  /** Just arrived here after a Submit/Release: flash for 1.5 s (spec §5.6 item 2). */
  arrived?: boolean
}

type CopyState = 'idle' | 'copied' | 'failed'

/** "Batch Mix v3 › Charge sub-flow › Inner": the innermost sub-flow — where the step
 *  actually sits — stays whole; the name, version and parent sub-flows give way first. */
export function workflowParts(t: InboxTask): [head: string, tail: string] {
  const name = t.masterVersion ? `${t.masterName} v${t.masterVersion}` : t.masterName
  const path = t.workflowPath ?? []
  if (path.length === 0) return [name, '']
  return [[name, ...path.slice(0, -1)].join(' › ') + ' › ', path[path.length - 1]!]
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the selection-based copy
  }
  // Plain http on a LAN address is not a secure context, so navigator.clipboard is absent.
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  try {
    area.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}

// Spec §5.3: the four facts an operator must never lose, labelled, above the task.
// Below 1024 px the labels and the workflow field drop out (frame.css) and runtime ID ·
// step · work center remain (§4).
export function ContextBar({ task, wcName, arrived = false }: ContextBarProps) {
  const [copy, setCopy] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const [wfHead, wfTail] = workflowParts(task)

  const onCopy = async () => {
    const ok = await copyText(task.runtimeLabel)
    setCopy(ok ? 'copied' : 'failed')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopy('idle'), 2000)
  }
  // P4-R3: the context bar exists only while a task pane is on screen, so this is that task.
  useShortcut('copy', () => {
    void onCopy()
  })

  return (
    <dl className={arrived ? 'context-bar context-bar-arrived' : 'context-bar'}>
      <div className="ctx-field ctx-step">
        <dt>Step</dt>
        <dd>{task.stepName ?? task.stepOid}</dd>
      </div>
      <div className="ctx-field ctx-workflow">
        <dt>Workflow</dt>
        <dd>
          <Elide head={wfHead} tail={wfTail} />
        </dd>
      </div>
      <div className="ctx-field ctx-runtime">
        <dt>Runtime ID</dt>
        <dd>
          <RuntimeId label={task.runtimeLabel} />
          <button type="button" className="ctx-copy" aria-label="Copy runtime ID" aria-keyshortcuts="Control+Shift+C" onClick={onCopy}>
            ⧉
          </button>
          <span role="status" className="ctx-copy-status">
            {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Copy failed — select the ID' : ''}
          </span>
        </dd>
      </div>
      <div className="ctx-field ctx-wc">
        <dt>Work center</dt>
        <dd>{wcName}</dd>
      </div>
    </dl>
  )
}
