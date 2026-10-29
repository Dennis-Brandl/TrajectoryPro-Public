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
import { Factory, Users, Workflow as WorkflowIcon, Shield, Boxes, History, Settings as SettingsIcon, Activity, HelpCircle } from 'lucide-react';
import { useSelectionStore, type Hierarchy } from '@/stores/selectionStore';
import { cn } from '@/lib/utils';
const ITEMS: { key: Hierarchy; label: string; icon: typeof Factory; enabled: boolean }[] = [
  { key: 'work_center', label: 'Work Centers', icon: Factory, enabled: true },
  { key: 'runtime', label: 'Runtime', icon: Activity, enabled: true },
  { key: 'user', label: 'Users', icon: Users, enabled: true },
  { key: 'workflow', label: 'Workflows', icon: WorkflowIcon, enabled: true },
  { key: 'environment', label: 'Environments', icon: Boxes, enabled: true },
  { key: 'role', label: 'Roles', icon: Shield, enabled: true },
  { key: 'history', label: 'History', icon: History, enabled: true },
  { key: 'settings', label: 'Settings', icon: SettingsIcon, enabled: true },
];
export function ActivityRail() {
  const active = useSelectionStore((s) => s.activeHierarchy);
  const setHierarchy = useSelectionStore((s) => s.setHierarchy);
  return (
    <nav className="flex w-14 flex-col items-center gap-1 border-r py-2">
      {ITEMS.map(({ key, label, icon: Icon, enabled }) => (
        <button key={key} aria-label={label} title={enabled ? label : `${label} — coming later`}
          disabled={!enabled} onClick={() => setHierarchy(key)}
          className={cn('flex size-10 items-center justify-center rounded-md disabled:opacity-40',
            active === key ? 'bg-accent text-accent-foreground' : 'hover:bg-accent')}>
          <Icon className="size-5" />
        </button>
      ))}
      {/* Help (2026-09-14) sits at the foot of the rail, not in the header: the header's right-hand
          group has a measured width budget that keeps the banner centred (_authenticated.tsx). */}
      <a href="/help.html" target="_blank" rel="noopener noreferrer" aria-label="Help"
        title="Open the user guide in a new tab"
        className="mt-auto flex size-10 items-center justify-center rounded-md hover:bg-accent">
        <HelpCircle className="size-5" />
      </a>
    </nav>
  );
}
