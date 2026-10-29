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
import { workflows } from '@/lib/api/workflows';
import { apiErrorMessage } from '@/lib/api/client';
import type { Workflow } from '@/lib/api/types';
import { useSelectionStore } from '@/stores/selectionStore';
import { cn } from '@/lib/utils';
import { NameWithType } from '@/components/shared/NameWithType';
import { groupByWorkCenter } from '@/components/artifact/groupByWorkCenter';
import { StateBadge } from '@/components/artifact/StateBadge';

// Module-level refresh handle, matching refreshRoleTree/refreshTree: a plain function call
// from any mutation site, with no provider wiring.
let refreshHandler: (() => void) | null = null;
export function refreshWorkflowTree() { refreshHandler?.(); }

export function WorkflowTree() {
  // null = still loading; [] = loaded and genuinely empty. Without this distinction the
  // empty state renders during the first fetch.
  const [items, setItems] = useState<Workflow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const selectedWorkflowId = useSelectionStore((s) => s.selectedWorkflowId);
  const selectWorkflow = useSelectionStore((s) => s.selectWorkflow);

  const load = useCallback(() => {
    workflows.list()
      .then(({ workflows: list }) => { setItems(list); setLoadError(null); })
      .catch((err) => setLoadError(apiErrorMessage(err, 'Failed to load workflows')));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { refreshHandler = load; return () => { refreshHandler = null; }; }, [load]);

  // The server already orders by (workCenter.name, name, version, state); this only groups.
  // Entries are FLAT within a group — M6 retired lineage grouping, because copies of one
  // workflow are independent entries with no lineage to express. They simply sit adjacent.
  const groups = groupByWorkCenter(items ?? []);

  return (
    <div className="flex flex-col gap-1 p-2">
      {/* No Import/Pull control: M6 moved loading onto the work center, where the steward
          can target several work centers in one action. */}
      <div className="flex items-center px-2 py-1">
        <span className="text-sm font-medium text-muted-foreground">Workflows</span>
      </div>
      {loadError && <div className="px-2 text-sm text-destructive">{loadError}</div>}
      {!loadError && items?.length === 0 && (
        <p className="px-2 text-sm text-muted-foreground">No workflows loaded</p>
      )}
      {/* Visually grouped by work center, but not a real (keyboard-navigable) ARIA tree,
          so role="list" rather than the decorative role="tree" this used to carry. */}
      <div role="list">
        {groups.map((group) => (
          <div key={group.workCenterId} role="listitem">
            <h3 className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">{group.workCenterName}</h3>
            <div>
              {group.items.map((wf) => (
                <button key={wf.id} type="button" onClick={() => selectWorkflow(wf.id)}
                  className={cn('flex w-full items-center gap-2 rounded py-1 pl-4 pr-2 text-left text-sm',
                    selectedWorkflowId === wf.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent')}>
                  <span className="truncate"><NameWithType name={<>{wf.name} v{wf.version}</>} typeName={wf.typeName} /></span>
                  <StateBadge state={wf.state} effectiveFrom={wf.effectiveFrom} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
