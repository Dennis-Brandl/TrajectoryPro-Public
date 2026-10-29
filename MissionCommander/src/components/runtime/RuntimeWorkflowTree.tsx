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
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { useSelectionStore } from '@/stores/selectionStore';
import { cn } from '@/lib/utils';
import { buildForest, type TreeNode } from '@/components/work-center/tree';
import { RuntimeStatusBadge } from './RuntimeStatusBadge';
import type { ActiveRuntimeLeaf } from '@/lib/api/types';

export const RUNTIME_TREE_POLL_MS = 5000;

// The Runtime pane's hierarchy (spec 2026-08-27 §4.2): the TRUE work-center tree
// (buildForest, like WorkCenterTree — not the flat Environments grouping) with each
// center's ACTIVE runtime workflows as selectable leaves. Every work center renders even
// with zero active workflows (the em-dash line); pending/finished stay on the per-WC
// Runtime tab — this pane is the live-control surface. One 5 s poll feeds the whole tree.
export function RuntimeWorkflowTree() {
  const fetcher = useCallback(() => runtimeWorkflows.activeTree(), []);
  const { view, loading, error, stale } = usePolledView(
    'runtime-tree', fetcher, 'Failed to load runtime workflows', RUNTIME_TREE_POLL_MS,
  );
  const selectedId = useSelectionStore((s) => s.selectedRuntimeWorkflowId);
  const selectRuntimeWorkflow = useSelectionStore((s) => s.selectRuntimeWorkflow);

  if (loading && !view) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (error && !view) return <p className="p-4 text-sm text-destructive">Failed to load runtime workflows</p>;
  if (!view) return null;

  const leavesByWc = new Map<string, ActiveRuntimeLeaf[]>();
  for (const rw of view.runtimeWorkflows) {
    const list = leavesByWc.get(rw.workCenterId) ?? [];
    list.push(rw);
    leavesByWc.set(rw.workCenterId, list);
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="px-2 py-1">
        <span className="text-sm font-medium text-muted-foreground">Runtime</span>
      </div>
      {stale && (
        <p className="px-2 text-xs text-muted-foreground" role="status">
          Live view unavailable — showing last known state
        </p>
      )}
      <div role="tree">
        {buildForest(view.nodes).map((node) => (
          <RuntimeTreeRow key={node.id} node={node} depth={0} leavesByWc={leavesByWc}
            selectedId={selectedId} onSelect={selectRuntimeWorkflow} />
        ))}
      </div>
    </div>
  );
}

type RowProps = {
  node: TreeNode; depth: number; leavesByWc: Map<string, ActiveRuntimeLeaf[]>;
  selectedId: string | null; onSelect: (id: string) => void;
};

function RuntimeTreeRow({ node, depth, leavesByWc, selectedId, onSelect }: RowProps) {
  // Local expansion state (default open) survives the 5 s poll because the row's identity
  // (key = node.id) is stable across refetches — no reseed-fights-collapse hazard.
  const [open, setOpen] = useState(true);
  const leaves = leavesByWc.get(node.id) ?? [];
  const paddingLeft = depth * 12 + 8;

  return (
    <div role="treeitem" aria-selected={false} aria-expanded={open}>
      <div className="flex items-center gap-1 rounded py-1 pr-2 hover:bg-accent" style={{ paddingLeft }}>
        <button type="button" aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
          onClick={() => setOpen((v) => !v)} className="flex size-4 shrink-0 items-center justify-center">
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
        <span className="flex-1 truncate text-sm">{node.name}</span>
        {leaves.length > 0 && (
          <span className="shrink-0 rounded bg-accent px-1.5 text-[10px] text-accent-foreground"
            title={`${leaves.length} active runtime workflows`}>
            {leaves.length}
          </span>
        )}
      </div>
      {open && (
        <div role="group">
          {leaves.map((rw) => (
            <button key={rw.id} type="button" onClick={() => onSelect(rw.id)}
              className={cn('flex w-full items-center gap-2 rounded py-1 pr-2 text-left text-sm',
                selectedId === rw.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent')}
              style={{ paddingLeft: paddingLeft + 24 }}>
              <span className="min-w-0 flex-1 truncate">{rw.runtimeLabel} · {rw.masterName}</span>
              <RuntimeStatusBadge status={rw.status} />
            </button>
          ))}
          {leaves.length === 0 && (
            <p className="py-1 text-sm text-muted-foreground" style={{ paddingLeft: paddingLeft + 24 }}
              aria-label={`No active runtime workflows in ${node.name}`}>—</p>
          )}
          {node.children.map((child) => (
            <RuntimeTreeRow key={child.id} node={child} depth={depth + 1} leavesByWc={leavesByWc}
              selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
