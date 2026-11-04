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

import { useLocation, useNavigate } from 'react-router'
import { FolderTree, LayoutDashboard, Play, ScrollText, Search } from 'lucide-react'
import { ActivityRail, type RailItem } from '@mission/ui'
import { usePanelContext } from './PanelContext'
import { railActiveId, type RailId } from './rail'

// The cast bridges two copies of the React types (this console's and the linked
// UI package's), which make otherwise identical icon types incompatible.
const items = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'environments', icon: FolderTree, label: 'Environments' },
  { id: 'instances', icon: Play, label: 'Instances' },
  { id: 'log', icon: ScrollText, label: 'Log' },
  { id: 'search', icon: Search, label: 'Search' },
] as unknown as (RailItem & { id: RailId })[]

export default function ActivityBar() {
  const { activePanel, setActivePanel, togglePanel } = usePanelContext()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const activeId = railActiveId(pathname, activePanel)

  function onSelect(id: string) {
    const active = id === activeId
    switch (id as RailId) {
      case 'dashboard':
        if (active) return
        void navigate('/')
        setActivePanel(null)
        return
      case 'environments':
        if (active) return togglePanel('explorer')
        void navigate('/environments')
        setActivePanel('explorer')
        return
      case 'instances':
        if (active) return togglePanel('instances')
        void navigate('/instances')
        setActivePanel('instances')
        return
      case 'log':
        if (active) return
        void navigate('/log')
        setActivePanel(null)
        return
      case 'search':
        setActivePanel(active ? null : 'search')
        return
    }
  }

  return <ActivityRail items={items} activeId={activeId} onSelect={onSelect} />
}
