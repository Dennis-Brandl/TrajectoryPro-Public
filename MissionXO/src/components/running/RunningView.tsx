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
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import type { RuntimeListFilter, RuntimeWorkflowMonitorSummary } from '@/lib/api/types';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { Button } from '@mission/ui';
import { cn } from '@/lib/utils';
import { useLayout } from '~/lib/layout';
import { splitByAttention } from '~/lib/attention';
import { useWorkCenter } from '~/components/shell/WorkCenterShell';
import { ConnectionBanner } from './ConnectionBanner';
import { useReportConnection } from './connection';
import { FilterChips } from './FilterChips';
import { RuntimeRow } from './RuntimeRow';
import { useSplitView } from './useSplitView';

const POLL_MS = 5000;

const GROUP_LABEL = 'px-1 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wider';

export function RunningView({ selectedId, detail }: { selectedId?: string; detail: ReactNode }) {
  const wc = useWorkCenter();
  const navigate = useNavigate();
  const layout = useLayout();
  const split = useSplitView();
  const report = useReportConnection();
  const [filter, setFilterState] = useState<RuntimeListFilter>('active');
  const [page, setPage] = useState(1);
  const setFilter = (f: RuntimeListFilter) => { setFilterState(f); setPage(1); };
  const { view, loading, error, stale } = usePolledView(
    `${wc.id}:${filter}:${page}`,
    () => runtimeWorkflows.list(wc.id, { filter, page }),
    'Could not load runtimes',
    POLL_MS,
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  useEffect(() => { if (view) setLastUpdatedAt(new Date()); }, [view]);
  useEffect(() => { report(stale || (error !== null && view !== null), lastUpdatedAt); }, [report, stale, error, view, lastUpdatedAt]);

  const pageCount = view ? Math.max(1, Math.ceil(view.total / view.pageSize)) : 1;
  const rows = view?.runtimeWorkflows ?? [];
  const { attention, rest } = splitByAttention(rows);
  const ordered = [...attention, ...rest];

  const open = (id: string) => {
    void navigate({ to: '/wc/$wcId/running/$runtimeId', params: { wcId: wc.id, runtimeId: id } });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (layout !== 'desktop' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || ordered.length === 0) return;
    e.preventDefault();
    const i = ordered.findIndex((r) => r.id === selectedId);
    const next = e.key === 'ArrowDown' ? Math.min(ordered.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
    open(ordered[next].id);
  };

  const group = (label: string, items: RuntimeWorkflowMonitorSummary[], tone: string) => items.length > 0 && (
    <div role="group" aria-label={label}>
      <div className={cn(GROUP_LABEL, tone)}>{label}</div>
      <div className="flex flex-col gap-2">
        {items.map((r) => (
          <RuntimeRow key={r.id} runtime={r} selected={r.id === selectedId} onSelect={() => open(r.id)} />
        ))}
      </div>
    </div>
  );

  const list = (
    <div className="flex h-full min-h-0 flex-col">
      <ConnectionBanner stale={stale || (error !== null && view !== null)} lastUpdatedAt={lastUpdatedAt} />
      <div className="shrink-0 px-4 pt-3">
        <FilterChips value={filter} counts={view?.statusCounts} onChange={setFilter} compact={layout === 'desktop'} />
      </div>
      <div
        role="listbox"
        aria-label="Runtimes"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-auto px-4 pb-4 outline-none"
      >
        {group('Needs attention', attention, 'text-status-warn-fg')}
        {group(attention.length > 0 ? 'Running' : 'Runtimes', rest, 'text-muted-foreground')}
        {loading && !view && <p className="py-6 text-sm text-muted-foreground">Loading…</p>}
        {error && !view && <p className="py-6 text-sm text-destructive">{error}</p>}
        {view && rows.length === 0 && <p className="py-6 text-sm text-muted-foreground">No runtimes here.</p>}
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
  // Tablet portrait and phone: the list, or the detail on its own when a runtime is selected.
  return <div className="h-full min-h-0">{selectedId ? detail : list}</div>;
}
