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
import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { schedules } from '@/lib/api/schedules';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { useSelectionStore, type ScheduleSelection } from '@/stores/selectionStore';
import { cn, treeRowClass, PaneLabel } from '@mission/ui';
import { buildForest, type TreeNode } from '@/components/work-center/tree';
import type { LiveRuntimeScheduleLeaf } from '@/lib/api/types';
import { formatInZone } from './schedule-format';

export const SCHEDULE_TREE_POLL_MS = 5000;

// The Schedules pane (spec 2026-11-25): the true work-center tree, as the Runtime pane draws it,
// with each center's Runtime Schedules that are on (active or paused) as selectable leaves. Every
// work center renders, with a dash when none is on. One 5 s poll feeds the whole tree.
export function ScheduleRailTree() {
  const fetcher = useCallback(() => schedules.liveTree(), []);
  const { view, loading, error, stale } = usePolledView(
    'schedule-tree', fetcher, 'Failed to load schedules', SCHEDULE_TREE_POLL_MS,
  );
  const selectedId = useSelectionStore((s) => s.selectedRuntimeSchedule?.id ?? null);
  const select = useSelectionStore((s) => s.selectRuntimeSchedule);

  if (loading && !view) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (error && !view) return <p className="p-4 text-sm text-destructive">Failed to load schedules</p>;
  if (!view) return null;

  const leavesByWc = new Map<string, LiveRuntimeScheduleLeaf[]>();
  for (const rs of view.runtimeSchedules) {
    const list = leavesByWc.get(rs.workCenterId) ?? [];
    list.push(rs);
    leavesByWc.set(rs.workCenterId, list);
  }

  return (
    <div className="flex flex-col">
      <PaneLabel>Schedules</PaneLabel>
      {stale && (
        <p className="px-3 py-1 text-xs text-muted-foreground" role="status">
          Live view unavailable — showing last known state
        </p>
      )}
      <div role="tree">
        {buildForest(view.nodes).map((node) => (
          <ScheduleTreeRow key={node.id} node={node} depth={0} leavesByWc={leavesByWc}
            selectedId={selectedId} onSelect={select} />
        ))}
      </div>
    </div>
  );
}

type RowProps = {
  node: TreeNode; depth: number; leavesByWc: Map<string, LiveRuntimeScheduleLeaf[]>;
  selectedId: string | null; onSelect: (sel: ScheduleSelection) => void;
};

/** "Paused", or when it starts next in the schedule's own zone. */
function whenText(rs: LiveRuntimeScheduleLeaf): string | null {
  if (rs.status === 'paused') return 'Paused';
  return rs.nextFireAt ? `next ${formatInZone(rs.nextFireAt, rs.timeZone)}` : null;
}

function ScheduleTreeRow({ node, depth, leavesByWc, selectedId, onSelect }: RowProps) {
  const [open, setOpen] = useState(true);
  const leaves = leavesByWc.get(node.id) ?? [];
  const paddingLeft = depth * 16 + 8;

  return (
    <div role="treeitem" aria-selected={false} aria-expanded={open}>
      <div className={treeRowClass({ depth: Math.min(depth, 2) as 0 | 1 | 2 })}
        style={depth > 2 ? { paddingLeft } : undefined}>
        <button type="button" aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
          onClick={() => setOpen((v) => !v)} className="flex size-4 shrink-0 items-center justify-center">
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
        <span className="flex-1 truncate">{node.name}</span>
        {leaves.length > 0 && (
          <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground"
            title={`${leaves.length} schedules on`}>
            {leaves.length}
          </span>
        )}
      </div>
      {open && (
        <div role="group">
          {leaves.map((rs) => {
            const when = whenText(rs);
            return (
              <button key={rs.id} type="button" onClick={() => onSelect({ id: rs.id, workCenterId: rs.workCenterId })}
                className={cn(treeRowClass({ selected: selectedId === rs.id }), 'w-full gap-2 text-left', when && 'h-auto min-h-6 py-0.5')}
                style={{ paddingLeft: paddingLeft + 24 }}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{rs.label} · {rs.name}</span>
                  {when && <span className="truncate text-xs text-muted-foreground">{when}</span>}
                </span>
              </button>
            );
          })}
          {leaves.length === 0 && (
            <p className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: paddingLeft + 24 }}
              aria-label={`No schedules on in ${node.name}`}>—</p>
          )}
          {node.children.map((child) => (
            <ScheduleTreeRow key={child.id} node={child} depth={depth + 1} leavesByWc={leavesByWc}
              selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
