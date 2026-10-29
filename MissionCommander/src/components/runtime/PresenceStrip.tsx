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
import { RUNTIME_LIST_POLL_MS } from './useRuntimeWorkflows';

/** Who is attending this work center (spec D6) — dot color keys presence: green online,
 *  amber away. Same 5 s cadence as the grid poll. */
export function PresenceStrip({ workCenterId }: { workCenterId: string }) {
  const fetcher = useCallback(() => runtimeWorkflows.presence(workCenterId), [workCenterId]);
  const { view } = usePolledView(`presence:${workCenterId}`, fetcher, 'Failed to load presence', RUNTIME_LIST_POLL_MS);
  if (!view || view.presence.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span>Operators:</span>
      {view.presence.map((p) => (
        <span key={p.userId} className="flex items-center gap-1">
          <span aria-hidden className={`size-2 rounded-full ${p.status === 'online' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {p.name ?? 'unknown'}
          <span className="sr-only">({p.status})</span>
        </span>
      ))}
    </div>
  );
}
