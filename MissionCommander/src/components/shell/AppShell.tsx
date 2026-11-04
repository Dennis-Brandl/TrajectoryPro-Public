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
import { useEffect, useState } from 'react';
import { SidePane } from '@mission/ui';
import { useSelectionStore } from '@/stores/selectionStore';
import { ActivityRail } from './ActivityRail';
import { HierarchyPane } from './HierarchyPane';
import { DetailPanel } from './DetailPanel';

export function AppShell() {
  const activeHierarchy = useSelectionStore((s) => s.activeHierarchy);
  // Clicking the active rail item toggles the tree pane; choosing another item shows it.
  const [paneHidden, setPaneHidden] = useState(false);
  // History and Settings are full-width pages with no tree to select from.
  const hasTree = activeHierarchy !== 'history' && activeHierarchy !== 'settings';
  // Leaving or entering a full-width page forgets a hidden pane, so it comes back as usual.
  useEffect(() => { setPaneHidden(false); }, [hasTree]);
  return (
    <div className="flex h-full">
      <ActivityRail onItemClick={(wasActive) => setPaneHidden(wasActive ? (h) => !h : false)} />
      {/* Hidden with CSS, not unmounted, so the tree keeps its expanded state. */}
      {hasTree && (
        <div data-testid="side-pane-wrap" className={paneHidden ? 'hidden' : 'contents'}>
          <SidePane storageKey="mission-commander-side-pane-width"><HierarchyPane /></SidePane>
        </div>
      )}
      <main className="min-h-0 min-w-0 flex-1 overflow-auto"><DetailPanel /></main>
    </div>
  );
}
