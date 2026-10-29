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
import { useKeyedView } from '@/lib/hooks/useKeyedView';
import { runtimeHistory } from '@/lib/api/runtime-history';
import { HistoryFilters } from './HistoryFilters';
import { HistoryTable } from './HistoryTable';
import { HistoryPager } from './HistoryPager';
import { RuntimeDialogStack } from '@/components/runtime/RuntimeDialogStack';
import type { RuntimeHistoryListParams } from '@/lib/api/types';

/**
 * Per-work-center History tab (phase 7): filters -> table -> pagination, the same
 * filters-chip / Prev-Next-pagination idiom RuntimeTab established in phase 6.
 *
 * p7 sweep ticket 5: uses `useKeyedView` (a composite `{ wcId, ...params }` JSON key, same
 * shape as before) instead of `useResourceView` — a filter OR page commit keeps the filter
 * bar and table mounted (`loading` signals via `aria-busy` instead of unmounting to a
 * spinner), so a date-field edit no longer loses focus. `refresh()` always refetches the
 * current key, so `handleFiltersChange` only calls it when the new params hash to the SAME
 * key as before (e.g. a Refresh click with otherwise-unchanged filters) — a changed key
 * already fires the hook's own key-effect on its own, and calling refresh() unconditionally
 * there would fire a second, redundant fetch built from the pre-update closure (the OLD
 * params), which the token guard would then deterministically discard as stale.
 */
export function HistoryTab({ workCenterId }: { workCenterId: string }) {
  const [params, setParams] = useState<RuntimeHistoryListParams>({ page: 1 });
  const [openId, setOpenId] = useState<string | null>(null);
  const key = JSON.stringify({ wcId: workCenterId, ...params });
  const { view, loading, error, refresh } = useKeyedView(
    key,
    () => runtimeHistory.listForWorkCenter(workCenterId, params),
    'Failed to load history',
  );

  const handleFiltersChange = (next: RuntimeHistoryListParams) => {
    const sameKey = JSON.stringify({ wcId: workCenterId, ...next }) === key;
    setParams(next);
    if (sameKey) refresh();
  };

  // Local-page single source (phase-6 sweep lesson, RuntimeTab.tsx): the footer and the
  // Prev/Next disabled state read `params.page`, never `view.page` — a late response
  // carrying a stale `page` field must never disagree with the buttons that drove the click.
  const page = params.page ?? 1;
  const setPage = (p: number) => setParams((prev) => ({ ...prev, page: p }));

  // Empty-page snap-back (phase-7 final review, RuntimeTab.tsx precedent): deleting the last
  // row on page 2+ (or a purge) leaves this page empty while `total` reports the page BEFORE
  // that page still has rows — clamp back to the last non-empty page rather than stranding the
  // view on "No history" with the Prev control hidden (pageCount recomputes to 1).
  useEffect(() => {
    if (!view || view.history.length > 0 || page <= 1) return;
    setPage(Math.max(1, Math.ceil(view.total / view.pageSize)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, page]);

  if (loading && !view) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error && !view) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">Failed to load history</p>
        <Button type="button" variant="outline" size="sm" onClick={() => refresh()}>Retry</Button>
      </div>
    );
  }
  if (!view) return null;
  const pageCount = Math.max(1, Math.ceil(view.total / view.pageSize));

  return (
    <div className="space-y-2" aria-busy={loading}>
      <HistoryFilters value={params} onChange={handleFiltersChange} />
      <HistoryTable rows={view.history} onOpen={setOpenId} />
      <HistoryPager page={page} pageCount={pageCount} onPage={setPage} />
      {openId !== null && (
        <RuntimeDialogStack initial={{ kind: 'history', id: openId }} onClose={() => setOpenId(null)} onHistoryDeleted={refresh} />
      )}
    </div>
  );
}
