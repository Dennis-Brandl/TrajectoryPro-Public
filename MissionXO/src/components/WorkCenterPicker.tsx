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
import { useEffect, useMemo, useState } from 'react';
import { workCenters } from '@/lib/api/work-centers';
import type { WcNode } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMeStore } from '~/stores/meStore';
import { orderWorkCenters } from '~/lib/access';
import { readLastWorkCenter, writeLastWorkCenter } from '~/lib/last-work-center';

const SEARCH_ABOVE = 8;

export function WorkCenterPicker({ onChoose, pick = false }: { onChoose: (id: string) => void; pick?: boolean }) {
  const me = useMeStore((s) => s.me);
  const [nodes, setNodes] = useState<WcNode[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    setFailed(false);
    workCenters.list().then(
      ({ nodes: list }) => {
        if (!live) return;
        const last = readLastWorkCenter();
        if (!pick && last && list.some((n) => n.id === last)) {
          onChoose(last);
          return;
        }
        setNodes(list);
      },
      () => { if (live) setFailed(true); },
    );
    return () => { live = false; };
    // onChoose is a navigation callback; re-fetching on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const rows = useMemo(
    () => (nodes && me ? orderWorkCenters(nodes, me) : []),
    [nodes, me],
  );

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-lg font-medium">Cannot load work centers</p>
        <Button variant="outline" className="min-h-11 xl:min-h-9" onClick={() => setAttempt((n) => n + 1)}>Retry</Button>
      </div>
    );
  }
  if (!nodes) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;

  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  const full = shown.filter((r) => r.mode === 'full');
  const viewOnly = shown.filter((r) => r.mode === 'view-only');

  const choose = (id: string) => { writeLastWorkCenter(id); onChoose(id); };
  const row = (r: (typeof rows)[number]) => (
    <button
      key={r.id}
      type="button"
      onClick={() => choose(r.id)}
      className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-[10px] border border-border bg-card px-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${r.mode === 'view-only' ? 'border-dashed' : ''}`}
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold">{r.name}</span>
        {r.typeName && <span className="block truncate text-sm text-muted-foreground">{r.typeName}</span>}
      </span>
      {r.mode === 'view-only' && <span className="shrink-0 text-xs text-muted-foreground">View only</span>}
    </button>
  );

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold">Choose a work center</h1>
        <p className="text-sm text-muted-foreground">XO opens this one next time.</p>
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">There are no work centers yet. They are set up in Mission Commander.</p>
      ) : (
        <>
          {rows.length > SEARCH_ABOVE && (
            <Input type="search" className="h-11 xl:h-9" aria-label="Search work centers" placeholder="Search work centers" value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
          <div className="flex flex-col gap-2">{full.map(row)}</div>
          {viewOnly.length > 0 && (
            <>
              <h2 className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">View only</h2>
              <div className="flex flex-col gap-2">{viewOnly.map(row)}</div>
            </>
          )}
        </>
      )}
    </div>
  );
}
