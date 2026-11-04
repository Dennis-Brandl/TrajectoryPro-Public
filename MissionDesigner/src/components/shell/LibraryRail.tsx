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

import { Workflow, Cog, Server, Zap } from 'lucide-react'
import { ActivityRail, type RailItem } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'
import { useFlowStore } from '@/stores/flowStore'
import type { EntityType } from '@/types/library'

const ITEMS: RailItem[] = [
  { id: 'workflow', label: 'Workflows', icon: Workflow },
  { id: 'step', label: 'Step Libraries', icon: Cog },
  { id: 'environment', label: 'Environments', icon: Server },
  { id: 'action', label: 'Actions', icon: Zap },
]

/** The four library kinds as a rail. Clicking the current one shows or hides the sidebar. */
export function LibraryRail() {
  const activeEntityType = useLibraryStore((s) => s.activeEntityType)
  const setActiveEntityType = useLibraryStore((s) => s.setActiveEntityType)
  const collapsed = useFlowStore((s) => s.librarySidebarCollapsed)
  const setCollapsed = useFlowStore((s) => s.setLibrarySidebarCollapsed)

  return (
    <ActivityRail
      items={ITEMS}
      activeId={activeEntityType}
      onSelect={(id) => {
        if (id === activeEntityType) {
          setCollapsed(!collapsed)
          return
        }
        setActiveEntityType(id as EntityType)
        setCollapsed(false)
      }}
    />
  )
}
