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
import { environments } from '@/lib/api/environments';
import { apiErrorMessage } from '@/lib/api/client';
import type { EnvironmentSpec } from '@/lib/api/types';
import { useSelectionStore } from '@/stores/selectionStore';
import { cn } from '@/lib/utils';
import { groupByWorkCenter } from '@/components/artifact/groupByWorkCenter';
import { StateBadge } from '@/components/artifact/StateBadge';

// Module-level refresh handle, matching refreshWorkflowTree/refreshRoleTree.
let refreshHandler: (() => void) | null = null;
export function refreshEnvironmentTree() { refreshHandler?.(); }

export function EnvironmentTree() {
  // null = still loading; [] = loaded and genuinely empty. Without this distinction the
  // empty state renders during the first fetch.
  const [items, setItems] = useState<EnvironmentSpec[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const selectedEnvironmentId = useSelectionStore((s) => s.selectedEnvironmentId);
  const selectEnvironment = useSelectionStore((s) => s.selectEnvironment);

  const load = useCallback(() => {
    environments.list()
      .then(({ environments: list }) => { setItems(list); setLoadError(null); })
      .catch((err) => setLoadError(apiErrorMessage(err, 'Failed to load environments')));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { refreshHandler = load; return () => { refreshHandler = null; }; }, [load]);

  // Grouped by owning work center; entries are flat within a group (see WorkflowTree).
  const groups = groupByWorkCenter(items ?? []);

  return (
    <div className="flex flex-col gap-1 p-2">
      {/* No Import/Pull control: M6 moved loading onto the work center. */}
      <div className="flex items-center px-2 py-1">
        <span className="text-sm font-medium text-muted-foreground">Environments</span>
      </div>
      {loadError && <div className="px-2 text-sm text-destructive">{loadError}</div>}
      {!loadError && items?.length === 0 && (
        <p className="px-2 text-sm text-muted-foreground">No environments loaded</p>
      )}
      <div role="list">
        {groups.map((group) => (
          <div key={group.workCenterId} role="listitem">
            <h3 className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">{group.workCenterName}</h3>
            <div>
              {group.items.map((spec) => (
                <button key={spec.id} type="button" onClick={() => selectEnvironment(spec.id)}
                  className={cn('flex w-full items-center gap-2 rounded py-1 pl-4 pr-2 text-left text-sm',
                    selectedEnvironmentId === spec.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent')}>
                  <span className="truncate">{spec.name} v{spec.version}</span>
                  <StateBadge state={spec.state} effectiveFrom={spec.effectiveFrom} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
