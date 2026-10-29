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
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { workCenters } from '@/lib/api/work-centers';
import { apiErrorMessage } from '@/lib/api/client';
import type { Workflow } from '@/lib/api/types';
import { useSelectionStore } from '@/stores/selectionStore';
import { useHasRight } from '@/stores/principalStore';
import { cn } from '@/lib/utils';
import { NameWithType } from '@/components/shared/NameWithType';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';
import { ImportPackageDialog } from './ImportPackageDialog';
import { refreshDetail } from './WorkCenterDetail';
import { buildForest, type TreeNode } from './tree';

// Task 11 imports refreshTree() to refetch the tree after create/update/delete
// mutations. A module-level handler (rather than a store/context) keeps this a
// plain function call from CRUD call sites, with no provider wiring required.
let refreshHandler: (() => void) | null = null;
export function refreshTree() {
  refreshHandler?.();
}

type WorkCenterTreeProps = { onCreateRoot: () => void; onCreateChild: (parentId: string) => void };

export function WorkCenterTree({ onCreateRoot, onCreateChild }: WorkCenterTreeProps) {
  const [forest, setForest] = useState<TreeNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [workflowsById, setWorkflowsById] = useState<Map<string, Workflow[]>>(new Map());
  const selectedWorkCenterId = useSelectionStore((s) => s.selectedWorkCenterId);
  const selectWorkCenter = useSelectionStore((s) => s.selectWorkCenter);
  // Display-only capability gating (Task 13) — see WorkCenterDetail.tsx for the
  // rationale; the server re-authorizes every mutation regardless.
  const canCreate = useHasRight('work_center:create');
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(() => {
    workCenters.list()
      .then(({ nodes }) => {
        setForest(buildForest(nodes));
        // Seed every node expanded so the whole hierarchy is visible on first
        // paint. Seeding bypasses toggle(), so no workflow fetches fire here —
        // a node lazily loads its workflows only when the user explicitly
        // re-expands it after a collapse. Accepted M1 side effect: refreshTree()
        // re-runs load, which re-seeds and resets any collapsed state.
        setExpanded(new Set(nodes.map((n) => n.id)));
        // Also drop any cached workflow leaves: refreshTree() is called after a
        // workflow link/unlink (Task 12), and a stale cached list must not survive
        // the refresh — nodes lazily refetch their workflows on next expand.
        setWorkflowsById(new Map());
        setLoadError(null);
        setLoaded(true);
      })
      .catch((err) => setLoadError(apiErrorMessage(err, 'Failed to load work centers')));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    refreshHandler = load;
    return () => { refreshHandler = null; };
  }, [load]);

  const toggle = useCallback((node: TreeNode) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
      return next;
    });
    // Fetch on first expand only — collapsing (or re-expanding) never re-fetches.
    if (!expanded.has(node.id) && !workflowsById.has(node.id)) {
      workCenters.get(node.id)
        .then((view) => setWorkflowsById((prev) => new Map(prev).set(node.id, view.workflows)))
        .catch(() => { /* leave uncached — next expand attempt retries */ });
    }
  }, [expanded, workflowsById]);

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-sm font-medium text-muted-foreground">Work Centers</span>
        <RequiresTooltip reason={canCreate ? undefined : 'Requires work_center:create'}>
          <button type="button" aria-label="New work center" onClick={onCreateRoot} disabled={!canCreate}
            title={canCreate ? undefined : 'Requires work_center:create'}
            className="flex size-6 items-center justify-center rounded hover:bg-accent disabled:pointer-events-none disabled:opacity-50">＋</button>
        </RequiresTooltip>
        <RequiresTooltip reason={canCreate ? undefined : 'Requires work_center:create'}>
          <button type="button" aria-label="Import package" onClick={() => setImportOpen(true)}
            disabled={!canCreate} title={canCreate ? undefined : 'Requires work_center:create'}
            className="flex size-6 items-center justify-center rounded hover:bg-accent disabled:pointer-events-none disabled:opacity-50">⭳</button>
        </RequiresTooltip>
      </div>
      {loadError && <div className="px-2 text-sm text-destructive">{loadError}</div>}
      {loaded && !loadError && forest.length === 0 && (
        <div className="flex flex-col gap-2 px-2 py-1 text-sm text-muted-foreground">
          {canCreate ? (
            <>
              <span>No work centers yet.</span>
              <div className="flex gap-2">
                <button type="button" onClick={onCreateRoot}
                  className="rounded border px-2 py-1 text-foreground hover:bg-accent">Create work center</button>
                <button type="button" onClick={() => setImportOpen(true)}
                  className="rounded border px-2 py-1 text-foreground hover:bg-accent">Import package</button>
              </div>
            </>
          ) : (
            <span>No work centers yet. Ask an administrator to create one or to give you access.</span>
          )}
        </div>
      )}
      <div role="tree">
        {forest.map((node) => (
          <TreeRow key={node.id} node={node} depth={0} expanded={expanded} workflowsById={workflowsById}
            selectedWorkCenterId={selectedWorkCenterId} onToggle={toggle}
            onSelect={selectWorkCenter} onCreateChild={onCreateChild} />
        ))}
      </div>
      <ImportPackageDialog
        open={importOpen} onOpenChange={setImportOpen}
        // Both panes can change: the tree gains/updates nodes, and (for a config-only merge,
        // or one that only touches artifacts already shown) the detail pane behind the dialog
        // must not keep showing stale data once the steward clicks Done. Mirrors LoadDialog's
        // onLoaded in WorkCenterDetail.tsx, which calls its own refresh() AND refreshTree().
        onImported={() => { refreshTree(); refreshDetail(); }}
      />
    </div>
  );
}

type TreeRowProps = {
  node: TreeNode; depth: number; expanded: Set<string>; workflowsById: Map<string, Workflow[]>;
  selectedWorkCenterId: string | null; onToggle: (node: TreeNode) => void;
  onSelect: (id: string) => void; onCreateChild: (parentId: string) => void;
};

function TreeRow({ node, depth, expanded, workflowsById, selectedWorkCenterId, onToggle, onSelect, onCreateChild }: TreeRowProps) {
  // Own useHasRight call rather than threading a canCreate prop through the
  // recursive TreeRowProps chain (Task 13 — see WorkCenterDetail.tsx's LinkButton
  // for the same no-prop-drilling rationale).
  const canCreate = useHasRight('work_center:create');
  const isExpanded = expanded.has(node.id);
  const cachedWorkflows = workflowsById.get(node.id);
  // A chevron only earns its keep if there's something for it to reveal: known
  // children, or workflows we haven't checked yet / did find. Once
  // checked-and-empty on a childless node, drop the dead toggle.
  const canExpand = node.children.length > 0 || cachedWorkflows === undefined || cachedWorkflows.length > 0;
  const isSelected = selectedWorkCenterId === node.id;
  const paddingLeft = depth * 12 + 8;
  // The group wrapper below should only appear once there's something in it —
  // otherwise an expanded-but-not-yet-fetched leaf (cachedWorkflows === undefined)
  // would render an empty, pointless role="group".
  // Distinct from canExpand above ON PURPOSE: canExpand keeps the chevron for a node we
  // haven't fetched yet (cachedWorkflows === undefined) so the user can try; hasRevealedContent
  // gates the role="group" wrapper and stays false until there's something real inside it,
  // so an expanded-but-not-yet-fetched leaf renders no empty group.
  const hasRevealedContent = node.children.length > 0 || (cachedWorkflows?.length ?? 0) > 0;

  return (
    <div role="treeitem" aria-selected={isSelected} aria-expanded={canExpand ? isExpanded : undefined}>
      <div className={cn('flex items-center gap-1 rounded py-1 pr-2', isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent')}
        style={{ paddingLeft }}>
        {canExpand ? (
          <button type="button" aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={() => onToggle(node)} className="flex size-4 shrink-0 items-center justify-center">
            {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : <span className="size-4 shrink-0" />}
        <button type="button" onClick={() => onSelect(node.id)} className="flex-1 truncate text-left text-sm">
          <NameWithType name={node.name} typeName={node.typeName} />
        </button>
        <RequiresTooltip reason={canCreate ? undefined : 'Requires work_center:create'}>
          <button type="button" aria-label={`New child of ${node.name}`} onClick={() => onCreateChild(node.id)}
            disabled={!canCreate} title={canCreate ? undefined : 'Requires work_center:create'}
            className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent disabled:pointer-events-none disabled:opacity-50">＋</button>
        </RequiresTooltip>
      </div>
      {isExpanded && hasRevealedContent && (
        <div role="group">
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} expanded={expanded} workflowsById={workflowsById}
              selectedWorkCenterId={selectedWorkCenterId} onToggle={onToggle} onSelect={onSelect} onCreateChild={onCreateChild} />
          ))}
          {(cachedWorkflows ?? []).map((wf) => (
            <div key={wf.id} className="truncate py-1 text-sm italic text-muted-foreground"
              style={{ paddingLeft: paddingLeft + 12 + 20 }}>
              <NameWithType name={wf.name} typeName={wf.typeName} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
