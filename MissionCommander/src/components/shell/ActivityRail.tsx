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
import { Factory, Users, Workflow as WorkflowIcon, Shield, Boxes, History, Activity } from 'lucide-react';
import { ActivityRail as SuiteRail, type RailItem } from '@mission/ui';
import { useSelectionStore, type Hierarchy } from '@/stores/selectionStore';

// Settings and Help live in the header now, so the rail holds only the seven hierarchies.
// The cast bridges two copies of lucide-react's icon types (this app's and @mission/ui's); the
// icons are the same components.
const ITEMS = [
  { id: 'work_center', label: 'Work Centers', icon: Factory },
  { id: 'runtime', label: 'Runtime', icon: Activity },
  { id: 'user', label: 'Users', icon: Users },
  { id: 'workflow', label: 'Workflows', icon: WorkflowIcon },
  { id: 'environment', label: 'Environments', icon: Boxes },
  { id: 'role', label: 'Roles', icon: Shield },
  { id: 'history', label: 'History', icon: History },
] as unknown as (RailItem & { id: Hierarchy })[];

// onItemClick lets the shell show or hide the tree pane: it learns whether the click landed
// on the item that was already active (hide or show) or on another (always show).
export function ActivityRail({ onItemClick }: { onItemClick?: (wasActive: boolean) => void }) {
  const active = useSelectionStore((s) => s.activeHierarchy);
  const setHierarchy = useSelectionStore((s) => s.setHierarchy);
  return (
    <SuiteRail
      items={ITEMS}
      activeId={active === 'settings' ? null : active}
      onSelect={(id) => {
        const wasActive = id === active;
        setHierarchy(id as Hierarchy);
        onItemClick?.(wasActive);
      }}
    />
  );
}
