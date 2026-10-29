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
import { useCallback } from 'react';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { useResourceView } from '@/lib/hooks/useResourceView';
import { RuntimeStatusBadge } from './RuntimeStatusBadge';
import type { CreatedRuntimesPage, CreatedRuntimeTarget } from '@/lib/api/types';

export const CREATED_RUNTIMES_POLL_MS = 2000;

type OnOpen = (t: CreatedRuntimeTarget) => void;

/** Spec 2026-10-19 §A: the runtimes one runtime created. Renders nothing when there are none. */
export function CreatedRuntimesList({ page, onOpen }: { page: CreatedRuntimesPage; onOpen: OnOpen }) {
  if (page.items.length === 0) return null;
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium">Created runtimes</h3>
      <ul className="space-y-1">
        {page.items.map((row, i) => (
          <li key={`${row.runtimeLabel}:${i}`}>
            {row.open ? (
              <button
                type="button"
                aria-label={`Open ${row.runtimeLabel}`}
                onClick={() => onOpen(row.open!)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded border px-2 py-1 text-left text-sm hover:bg-muted"
              >
                <span className="font-medium">{row.runtimeLabel}</span>
                <span className="text-muted-foreground">{row.workCenterPath}</span>
                <span>{row.workflowName} v{row.workflowVersion}</span>
                {row.createdAt && (
                  <time dateTime={row.createdAt} className="text-xs text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString()}
                  </time>
                )}
                {row.state && <RuntimeStatusBadge status={row.state} />}
              </button>
            ) : (
              <div className="rounded border px-2 py-1 text-sm">{row.runtimeLabel}</div>
            )}
          </li>
        ))}
      </ul>
      {page.total > page.items.length && (
        <p className="text-xs text-muted-foreground">Showing {page.items.length} of {page.total}</p>
      )}
    </div>
  );
}

export function LiveCreatedRuntimes({ instanceId, onOpen }: { instanceId: string; onOpen: OnOpen }) {
  const fetcher = useCallback(() => runtimeWorkflows.children(instanceId), [instanceId]);
  const { view } = usePolledView(`created-runtimes:${instanceId}`, fetcher, 'Failed to load created runtimes', CREATED_RUNTIMES_POLL_MS);
  return view ? <CreatedRuntimesList page={view} onOpen={onOpen} /> : null;
}

export function StaticCreatedRuntimes({ instanceId, onOpen }: { instanceId: string; onOpen: OnOpen }) {
  const { view } = useResourceView(instanceId, (id) => runtimeWorkflows.children(id), 'Failed to load created runtimes');
  return view ? <CreatedRuntimesList page={view} onOpen={onOpen} /> : null;
}
