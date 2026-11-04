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
import { Plus } from 'lucide-react';
import { Button, cn, treeRowClass, PaneLabel } from '@mission/ui';
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
    <div className="flex flex-col">
      <PaneLabel>Roles</PaneLabel>
      <div className="border-b border-border p-2">
        <RequiresTooltip block reason={canCreate ? undefined : 'Requires role:create'}>
          <Button variant="outline" size="sm" className="w-full" onClick={onCreateRole} disabled={!canCreate}
            title={canCreate ? undefined : 'Requires role:create'}>
            <Plus className="h-4 w-4" />
            New Role
          </Button>
        </RequiresTooltip>
      </div>
      {loadError && <div className="px-2 text-sm text-destructive">{loadError}</div>}
      <div role="list">
        {items.map((r) => (
          <button key={r.id} type="button" onClick={() => selectRole(r.id)}
            className={cn(treeRowClass({ selected: selectedRoleId === r.id }), 'w-full truncate text-left')}>
            {r.name}
          </button>
        ))}
      </div>
    </div>
  );
}
