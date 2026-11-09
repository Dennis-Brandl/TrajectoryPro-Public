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
import { useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { runtimeHistory } from '@/lib/api/runtime-history';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { Button } from '@mission/ui';
import { cn } from '@/lib/utils';
import { useLayout } from '~/lib/layout';
import { useWorkCenter } from '~/components/shell/WorkCenterShell';
import { useSplitView } from '~/components/running/useSplitView';
import { defaultHistoryFilters, type HistoryFilters } from './history-filters';
import { HistoryFiltersBar } from './HistoryFiltersBar';
import { HistoryList } from './HistoryList';

const REFRESH_MS = 60_000;

export function HistoryView({ selectedId, detail }: { selectedId?: string; detail: ReactNode }) {
  const wc = useWorkCenter();
  const navigate = useNavigate();
  const layout = useLayout();
  const split = useSplitView();
  const [filters, setFiltersState] = useState<HistoryFilters>(() => defaultHistoryFilters(new Date()));
  const [page, setPage] = useState(1);
  const setFilters = (f: HistoryFilters) => { setFiltersState(f); setPage(1); };
  const { view, loading, error } = usePolledView(
    `${wc.id}:${filters.from}:${filters.to}:${filters.state ?? ''}:${filters.search ?? ''}:${page}`,
    () => runtimeHistory.listForWorkCenter(wc.id, {
      from: filters.from || undefined, to: filters.to || undefined,
      state: filters.state, search: filters.search, page,
    }),
    'Could not load history',
    REFRESH_MS,
  );
  const rows = view?.history ?? [];
  const pageCount = view ? Math.max(1, Math.ceil(view.total / view.pageSize)) : 1;
  const open = (id: string) => { void navigate({ to: '/wc/$wcId/history/$historyId', params: { wcId: wc.id, historyId: id } }); };
  const openPass = (passId: string) => { void navigate({ to: '/wc/$wcId/history/pass/$passId', params: { wcId: wc.id, passId } }); };

  const list = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-3"><HistoryFiltersBar value={filters} onChange={setFilters} /></div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        <HistoryList rows={rows} selectedId={selectedId} onSelect={open} onSelectPass={openPass} now={new Date()} />
        {loading && !view && <p className="py-6 text-sm text-muted-foreground">Loading…</p>}
        {error && !view && <p className="py-6 text-sm text-destructive">{error}</p>}
        {view && rows.length === 0 && <p className="py-6 text-sm text-muted-foreground">No history here.</p>}
      </div>
      {view && view.total > view.pageSize && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-2 text-sm">
          <Button variant="outline" className="min-h-11" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-muted-foreground">Page {page} of {pageCount}</span>
          <Button variant="outline" className="min-h-11" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );

  if (split) {
    return (
      <div className="flex h-full min-h-0">
        <div className={cn('shrink-0 border-r border-border', layout === 'desktop' ? 'w-[400px] min-w-[360px]' : 'w-[420px]')}>{list}</div>
        <div className="min-w-0 flex-1 overflow-auto">{detail}</div>
      </div>
    );
  }
  return <div className="h-full min-h-0">{selectedId ? detail : list}</div>;
}
