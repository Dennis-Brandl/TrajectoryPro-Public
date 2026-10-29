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
import { users } from '@/lib/api/users';
import { apiErrorMessage } from '@/lib/api/client';
import type { AppUser } from '@/lib/api/types';
import { useSelectionStore } from '@/stores/selectionStore';
import { useHasRight } from '@/stores/principalStore';
import { cn } from '@/lib/utils';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';

// Module-level refresh handler (same pattern as WorkCenterTree.refreshTree): later
// tasks call refreshUserTree() after create / rename / status changes.
let refreshHandler: (() => void) | null = null;
export function refreshUserTree() { refreshHandler?.(); }

export function UserTree({ onCreateUser }: { onCreateUser: () => void }) {
  const [items, setItems] = useState<AppUser[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const selectedUserId = useSelectionStore((s) => s.selectedUserId);
  const selectUser = useSelectionStore((s) => s.selectUser);
  const canCreate = useHasRight('access:create');

  const load = useCallback(() => {
    users.list()
      .then(({ users: list }) => {
        setItems([...list].sort((a, b) => a.displayName.localeCompare(b.displayName)));
        setLoadError(null);
      })
      .catch((err) => setLoadError(apiErrorMessage(err, 'Failed to load users')));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { refreshHandler = load; return () => { refreshHandler = null; }; }, [load]);

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-sm font-medium text-muted-foreground">Users</span>
        <RequiresTooltip reason={canCreate ? undefined : 'Requires access:create'}>
          <button type="button" aria-label="New user" onClick={onCreateUser} disabled={!canCreate}
            title={canCreate ? undefined : 'Requires access:create'}
            className="flex size-6 items-center justify-center rounded hover:bg-accent disabled:pointer-events-none disabled:opacity-50">＋</button>
        </RequiresTooltip>
      </div>
      {loadError && <div className="px-2 text-sm text-destructive">{loadError}</div>}
      <div role="list">
        {items.map((u) => (
          <button key={u.id} type="button" onClick={() => selectUser(u.id)}
            className={cn('flex w-full items-center gap-2 truncate rounded px-2 py-1 text-left text-sm',
              selectedUserId === u.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent')}>
            <span className="truncate">{u.displayName}</span>
            {u.status === 'disabled' && <span className="ml-auto text-xs text-muted-foreground">disabled</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
