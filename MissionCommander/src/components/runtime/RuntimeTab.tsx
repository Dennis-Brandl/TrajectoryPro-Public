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
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRuntimeWorkflows } from './useRuntimeWorkflows';
import { RuntimeCard } from './RuntimeCard';
import { PresenceStrip } from './PresenceStrip';
import { RuntimeDialogStack } from './RuntimeDialogStack';
import type { RuntimeListFilter } from '@/lib/api/types';

const FILTER_CHIPS: Array<{ value: RuntimeListFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Waiting to start' },
  { value: 'finished', label: 'Finished' },
  { value: 'all', label: 'All' },
];

/** Phase-6 monitoring grid (spec §6): filter chips → presence strip → card grid → pagination.
 *  Lazy by the DiagramTab rule (child of TabsContent); the 5 s poll lives in the hook and dies
 *  with the tab unmount. All controls live in the detail dialog (D4). */
export function RuntimeTab({ workCenterId }: { workCenterId: string }) {
  const [filter, setFilter] = useState<RuntimeListFilter>('active');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const { view, loading, error, refresh } = useRuntimeWorkflows(workCenterId, filter, page);

  // Pagination drift (spec §7): a delete/filter can empty the current page — clamp back to the
  // last non-empty page when a fetch comes back empty above page 1.
  useEffect(() => {
    if (!view || view.runtimeWorkflows.length > 0 || page <= 1) return;
    setPage(Math.max(1, Math.ceil(view.total / view.pageSize)));
  }, [view, page]);

  if (loading && !view) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error && !view) return <p className="text-sm text-destructive">Failed to load runtime workflows</p>;
  if (!view) return null;
  const pageCount = Math.max(1, Math.ceil(view.total / view.pageSize));
  const rows = view.runtimeWorkflows;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {FILTER_CHIPS.map((chip) => (
            <Button key={chip.value} type="button" size="sm"
              variant={filter === chip.value ? 'secondary' : 'ghost'}
              onClick={() => { setFilter(chip.value); setPage(1); }}>
              {chip.value !== 'all' && view.statusCounts
                ? `${chip.label} (${view.statusCounts[chip.value]})`
                : chip.label}
            </Button>
          ))}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => refresh()}>Refresh</Button>
      </div>
      <PresenceStrip workCenterId={workCenterId} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runtime workflows</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
          {rows.map((rw) => <RuntimeCard key={rw.id} rw={rw} onOpen={setOpenId} />)}
        </div>
      )}
      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button type="button" variant="ghost" size="sm" disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <span className="text-muted-foreground">Page {page} of {pageCount}</span>
          <Button type="button" variant="ghost" size="sm" disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
      {openId !== null && <RuntimeDialogStack initial={{ kind: 'live', id: openId }} onClose={() => setOpenId(null)} />}
    </div>
  );
}
