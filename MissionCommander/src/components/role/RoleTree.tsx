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
import { roles } from '@/lib/api/roles';
import { apiErrorMessage } from '@/lib/api/client';
import type { Role } from '@/lib/api/types';
import { useSelectionStore } from '@/stores/selectionStore';
import { useHasRight } from '@/stores/principalStore';
import { cn } from '@/lib/utils';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';

let refreshHandler: (() => void) | null = null;
export function refreshRoleTree() { refreshHandler?.(); }

export function RoleTree({ onCreateRole }: { onCreateRole: () => void }) {
  const [items, setItems] = useState<Role[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const selectedRoleId = useSelectionStore((s) => s.selectedRoleId);
  const selectRole = useSelectionStore((s) => s.selectRole);
  const canCreate = useHasRight('role:create');

  const load = useCallback(() => {
    roles.list()
      .then(({ roles: list }) => {
        setItems([...list].sort((a, b) => a.name.localeCompare(b.name)));
        setLoadError(null);
      })
      .catch((err) => setLoadError(apiErrorMessage(err, 'Failed to load roles')));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { refreshHandler = load; return () => { refreshHandler = null; }; }, [load]);

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-sm font-medium text-muted-foreground">Roles</span>
        <RequiresTooltip reason={canCreate ? undefined : 'Requires role:create'}>
          <button type="button" aria-label="New role" onClick={onCreateRole} disabled={!canCreate}
            title={canCreate ? undefined : 'Requires role:create'}
            className="flex size-6 items-center justify-center rounded hover:bg-accent disabled:pointer-events-none disabled:opacity-50">＋</button>
        </RequiresTooltip>
      </div>
      {loadError && <div className="px-2 text-sm text-destructive">{loadError}</div>}
      <div role="list">
        {items.map((r) => (
          <button key={r.id} type="button" onClick={() => selectRole(r.id)}
            className={cn('flex w-full truncate rounded px-2 py-1 text-left text-sm',
              selectedRoleId === r.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent')}>
            {r.name}
          </button>
        ))}
      </div>
    </div>
  );
}
