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

import { FolderTree, Play, Search } from 'lucide-react'
import { usePanelContext, type PanelId } from './PanelContext'
import { cn } from '@mission/ui'

const items: { id: PanelId; icon: typeof FolderTree; label: string }[] = [
  { id: 'explorer', icon: FolderTree, label: 'Explorer' },
  { id: 'instances', icon: Play, label: 'Instances' },
  { id: 'search', icon: Search, label: 'Search' },
]

export default function ActivityBar() {
  const { activePanel, togglePanel } = usePanelContext()

  return (
    <div className="flex flex-col items-center w-10 bg-[var(--activity-bar)] border-r border-border shrink-0 pt-2 gap-1">
      {items.map(({ id, icon: Icon, label }) => {
        const isActive = activePanel === id
        return (
          <button
            key={id}
            onClick={() => togglePanel(id)}
            title={label}
            className={cn(
              'relative flex items-center justify-center w-8 h-8 rounded transition-colors',
              isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {isActive && (
              <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-primary rounded-r" />
            )}
            <Icon size={18} />
          </button>
        )
      })}
    </div>
  )
}
