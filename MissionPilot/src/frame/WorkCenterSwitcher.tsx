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

import { useState } from 'react'
import type { WorkCenter } from '../api/types'
import { Sheet } from './Sheet'
import { WorkCenterList } from './WorkCenterList'

export interface WorkCenterSwitcherProps {
  current: WorkCenter
  onSwitch(wc: WorkCenter): void
}

// Spec §5.1: a labelled control that changes work center without signing out. It does not
// ask first (P1c Ruling 2): leaving presence never releases claims, and typed values are
// kept as per-task drafts, so switching back restores every open form. The list mounts with
// the sheet, so every opening loads afresh (no stale list for a frame).
export function WorkCenterSwitcher({ current, onSwitch }: WorkCenterSwitcherProps) {
  const [open, setOpen] = useState(false)

  const choose = (wc: WorkCenter) => {
    setOpen(false)
    if (wc.id !== current.id) onSwitch(wc)
  }

  return (
    <>
      <button type="button" className="wc-switch" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span className="wc-switch-label">Work center</span>
        <span className="wc-switch-name">{current.name}</span>
      </button>
      {open && (
        <Sheet label="Switch work center" onClose={() => setOpen(false)}>
          <WorkCenterList currentId={current.id} onChoose={choose} />
        </Sheet>
      )}
    </>
  )
}
