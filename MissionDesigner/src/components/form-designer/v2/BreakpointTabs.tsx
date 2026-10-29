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
import { Smartphone, Tablet, Monitor } from 'lucide-react'
import type { BreakpointKey } from '@mission/form-schema'
import { useFormDocumentStore } from '@/stores/formDocumentStore'

/** Cosmetic editing-frame widths (px). Container-query resolution keys off these.
 *  `base` must stay >= 1024 so the renderer's container query still resolves the desktop tier. */
export const BREAKPOINT_FRAME_WIDTH: Record<BreakpointKey, number> = { base: 1152, tablet: 768, phone: 390 }

const TABS: { key: BreakpointKey; label: string; Icon: typeof Smartphone }[] = [
  { key: 'base', label: 'Desktop', Icon: Monitor },
  { key: 'tablet', label: 'Tablet', Icon: Tablet },
  { key: 'phone', label: 'Phone', Icon: Smartphone },
]

export function BreakpointTabs() {
  const active = useFormDocumentStore((s) => s.activeBreakpoint)
  const setActive = useFormDocumentStore((s) => s.setActiveBreakpoint)
  return (
    <div className="flex items-stretch border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
      {TABS.map(({ key, label, Icon }) => {
        const isActive = active === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => setActive(key)}
            aria-pressed={isActive}
            className={isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 36,
              padding: '0 16px',
              border: 'none',
              borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
