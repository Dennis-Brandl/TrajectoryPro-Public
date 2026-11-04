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

import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'

export interface RailItem {
  id: string
  label: string
  icon: LucideIcon
}

export function ActivityRail({
  items,
  activeId,
  onSelect,
}: {
  items: RailItem[]
  activeId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-activity-bar pt-2">
      {items.map(({ id, label, icon: Icon }) => {
        const active = id === activeId
        return (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(id)}
            className={cn(
              'relative flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              active && 'bg-muted text-foreground',
            )}
          >
            {active && <span className="absolute -left-1 top-1.5 bottom-1.5 w-0.5 rounded-r bg-brand-accent" />}
            <Icon className="size-5" />
          </button>
        )
      })}
    </nav>
  )
}
