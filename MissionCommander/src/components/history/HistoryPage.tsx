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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useKeyedView } from '@/lib/hooks/useKeyedView';
import { runtimeHistory } from '@/lib/api/runtime-history';
import { workCenters } from '@/lib/api/work-centers';
import { usePrincipalStore } from '@/stores/principalStore';
import { HistoryFilters } from './HistoryFilters';
import { HistoryTable } from './HistoryTable';
import { HistoryPager } from './HistoryPager';
import { RuntimeDialogStack } from '@/components/runtime/RuntimeDialogStack';
import { PurgeDialog } from './PurgeDialog';
import type { RuntimeHistoryListParams, WcNode } from '@/lib/api/types';

// Sentinels for the two non-id scope options — mirrors WorkCenterSelect's ROOT_VALUE (Radix
// Select forbids an empty item value). Unlike PurgeDialog's scope select, this one DOES offer
// orphans: the cross-WC list route (`/api/runtime-history`) accepts it, and a deleted work
// center's history rows are otherwise unreachable from this page.
const ALL_VALUE = '__all__';
const ORPHANS_VALUE = '__orphans__';

/**
 * Cross-work-center History page (phase 7 Task 8). Same filters -> table -> pagination ->
 * detail-dialog idiom HistoryTab established per-work-center (Task 6), plus a work-center
 * scope dropdown and an admin-only Purge control.
 *
 * p7 sweep: `useKeyedView` (ticket 5) replaces `useResourceView`'s composite-key usage — see
 * HistoryTab's docstring for the keep-stale / same-key-refresh() rationale, identical here.
 * `wcOptions` (ticket 4b) is the SINGLE fetch of the work-center list for this whole page;
 * PurgeDialog no longer fetches its own copy, it receives this list as a prop.
 */
export function HistoryPage() {
  const [params, setParams] = useState<RuntimeHistoryListParams>({ page: 1 });
  const [openId, setOpenId] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [wcOptions, setWcOptions] = useState<WcNode[]>([]);
  const isAdmin = usePrincipalStore((s) => s.principal?.isAdministrator ?? false);

  useEffect(() => {
    workCenters.list().then(({ nodes }) => setWcOptions(nodes)).catch(() => setWcOptions([]));
  }, []);

  const key = JSON.stringify(params);
  const { view, loading, error, refresh } = useKeyedView(
    key,
    () => runtimeHistory.listAll(params),
    'Failed to load history',
  );

  const handleFiltersChange = (next: RuntimeHistoryListParams) => {
    const sameKey = JSON.stringify(next) === key;
    setParams(next);
    if (sameKey) refresh();
  };

  const scopeValue = params.orphans ? ORPHANS_VALUE : (params.workCenterId ?? ALL_VALUE);
  const handleScopeChange = (v: string) => {
    const patch: Partial<RuntimeHistoryListParams> =
      v === ALL_VALUE ? { workCenterId: undefined, orphans: undefined }
      : v === ORPHANS_VALUE ? { workCenterId: undefined, orphans: true }
      : { workCenterId: v, orphans: undefined };
    handleFiltersChange({ ...params, ...patch, page: 1 });
  };

  // Local-page single source (phase-6 sweep lesson, RuntimeTab.tsx / HistoryTab.tsx): the
  // footer and the Prev/Next disabled state read `params.page`, never `view.page`.
  const page = params.page ?? 1;
  const setPage = (p: number) => setParams((prev) => ({ ...prev, page: p }));

  // Empty-page snap-back (phase-7 final review, RuntimeTab.tsx precedent): deleting the last
  // row on page 2+ (or an admin purge) leaves this page empty while `total` reports the page
  // BEFORE that page still has rows — clamp back to the last non-empty page rather than
  // stranding the view on "No history" with the Prev control hidden (pageCount recomputes to 1).
  useEffect(() => {
    if (!view || view.history.length > 0 || page <= 1) return;
    setPage(Math.max(1, Math.ceil(view.total / view.pageSize)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, page]);

  if (loading && !view) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error && !view) {
    return (
      <div className="space-y-2 p-4">
        <p className="text-sm text-destructive">Failed to load history</p>
        <Button type="button" variant="outline" size="sm" onClick={() => refresh()}>Retry</Button>
      </div>
    );
  }
  if (!view) return null;
  const pageCount = Math.max(1, Math.ceil(view.total / view.pageSize));

  return (
    <div className="space-y-2 p-4" aria-busy={loading}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <HistoryFilters value={params} onChange={handleFiltersChange} />
          <div className="space-y-1">
            <Label htmlFor="history-wc-scope" className="sr-only">Work center</Label>
            <Select value={scopeValue} onValueChange={handleScopeChange}>
              <SelectTrigger id="history-wc-scope" className="h-8 w-56" aria-label="Work center">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All work centers</SelectItem>
                {wcOptions.map((wc) => <SelectItem key={wc.id} value={wc.id}>{wc.name}</SelectItem>)}
                <SelectItem value={ORPHANS_VALUE}>(deleted work centers)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {isAdmin && (
          <Button type="button" variant="destructive" size="sm" onClick={() => setPurgeOpen(true)}>
            Purge…
          </Button>
        )}
      </div>

      <HistoryTable rows={view.history} onOpen={setOpenId} showWorkCenter />

      <HistoryPager page={page} pageCount={pageCount} onPage={setPage} />

      {openId !== null && (
        <RuntimeDialogStack initial={{ kind: 'history', id: openId }} onClose={() => setOpenId(null)} onHistoryDeleted={refresh} />
      )}

      {purgeOpen && isAdmin && (
        <PurgeDialog workCenters={wcOptions} onClose={() => setPurgeOpen(false)} onPurged={refresh} />
      )}
    </div>
  );
}
