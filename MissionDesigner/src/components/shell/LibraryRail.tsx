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

import { Workflow, Cog, Server, Zap, Users, UserCog } from 'lucide-react'
import { ActivityRail, type RailItem } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'
import { useFlowStore } from '@/stores/flowStore'
import { usePrincipalStore } from '@/stores/principalStore'
import type { EntityType } from '@/types/library'

const ITEMS: RailItem[] = [
  { id: 'workflow', label: 'Workflows', icon: Workflow },
  { id: 'step', label: 'Step Libraries', icon: Cog },
  { id: 'environment', label: 'Environments', icon: Server },
  { id: 'action', label: 'Actions', icon: Zap },
]

/** Administrator-only shortcuts: each opens that tab of the Administration page. */
export type AdminRailTab = 'teams' | 'accounts'
const ADMIN_ITEMS: (RailItem & { id: AdminRailTab })[] = [
  { id: 'teams', label: 'Teams', icon: Users },
  { id: 'accounts', label: 'Account', icon: UserCog },
]

/**
 * The four library kinds as a rail. Clicking the current one shows or hides the sidebar.
 * Administrators also get Teams and Account, which open the Administration page.
 */
export function LibraryRail({ onOpenAdmin }: { onOpenAdmin?: (tab: AdminRailTab) => void }) {
  const activeEntityType = useLibraryStore((s) => s.activeEntityType)
  const setActiveEntityType = useLibraryStore((s) => s.setActiveEntityType)
  const collapsed = useFlowStore((s) => s.librarySidebarCollapsed)
  const setCollapsed = useFlowStore((s) => s.setLibrarySidebarCollapsed)
  const isAdmin = usePrincipalStore((s) => s.principal?.isAdministrator === true)
  const showAdmin = isAdmin && onOpenAdmin !== undefined

  return (
    <ActivityRail
      items={showAdmin ? [...ITEMS, ...ADMIN_ITEMS] : ITEMS}
      activeId={activeEntityType}
      onSelect={(id) => {
        if (id === 'teams' || id === 'accounts') {
          onOpenAdmin?.(id)
          return
        }
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
