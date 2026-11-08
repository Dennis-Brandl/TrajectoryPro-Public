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
import { Check } from 'lucide-react';
import type { WorkflowWithRoleCount } from '@/lib/api/types';
import { cn } from '@/lib/utils';

export function StateBadge({ state }: { state: string }) {
  return (
    <span className="shrink-0 rounded bg-status-warn-bg px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-status-warn-fg">
      {state}
    </span>
  );
}

export function WorkflowPicker({ workflows, selectedId, onSelect }: {
  workflows: WorkflowWithRoleCount[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div role="listbox" aria-label="Workflows" className="flex flex-col gap-2">
      {workflows.map((w) => {
        const selected = w.id === selectedId;
        return (
          <div
            key={w.id}
            role="option"
            aria-selected={selected}
            tabIndex={0}
            onClick={() => onSelect(w.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(w.id); } }}
            className={cn(
              'flex min-h-14 cursor-pointer items-center justify-between gap-2 rounded-[10px] border px-3 py-2 text-sm',
              selected ? 'border-selection bg-selection/10' : 'border-border bg-card',
            )}
          >
            <span className="min-w-0 truncate font-semibold">
              {w.name} <span className="font-normal text-muted-foreground">v{w.version}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {w.state !== 'Released' && <StateBadge state={w.state} />}
              {selected && <Check className="size-4 text-selection" aria-hidden />}
            </span>
          </div>
        );
      })}
    </div>
  );
}
