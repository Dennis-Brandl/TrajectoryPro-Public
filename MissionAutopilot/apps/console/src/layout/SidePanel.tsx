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

import { usePanelContext } from './PanelContext'
import ExplorerPanel from '@/features/explorer/ExplorerPanel'
import InstancesPanel from '@/features/instances-panel/InstancesPanel'
import SearchPanel from '@/features/search-panel/SearchPanel'

export default function SidePanel() {
  const { activePanel } = usePanelContext()

  if (!activePanel) return null

  return (
    <div className="w-56 bg-[var(--side-panel)] border-r border-border shrink-0 overflow-y-auto">
      {activePanel === 'explorer' && <ExplorerPanel />}
      {activePanel === 'instances' && <InstancesPanel />}
      {activePanel === 'search' && <SearchPanel />}
    </div>
  )
}
