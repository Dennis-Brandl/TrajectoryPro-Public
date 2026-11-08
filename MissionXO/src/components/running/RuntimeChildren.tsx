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
import { useNavigate } from '@tanstack/react-router';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { RuntimeStatusBadge } from '@/components/runtime/RuntimeStatusBadge';
import { useWorkCenter } from '~/components/shell/WorkCenterShell';

/** Runtimes this one created. A live child in this work center opens in Running; any other
 *  child shows its label only. */
export function RuntimeChildren({ instanceId }: { instanceId: string }) {
  const wc = useWorkCenter();
  const navigate = useNavigate();
  const fetcher = useCallback(() => runtimeWorkflows.children(instanceId), [instanceId]);
  const { view } = usePolledView(`xo-children:${instanceId}`, fetcher, 'Could not load child runtimes', 5000);
  if (!view || view.items.length === 0) return null;
  return (
    <section className="space-y-1" aria-label="Child runtimes">
      <h3 className="text-sm font-medium">Child runtimes</h3>
      <ul className="space-y-1">
        {view.items.map((c, i) => {
          // The path ends with the work center's name; the row carries no id of the work center.
          const here = c.open?.kind === 'live' && !!c.workCenterPath && c.workCenterPath.split('/').pop()?.trim() === wc.name;
          const body = (
            <>
              <span className="font-medium">{c.runtimeLabel}</span>
              {c.workflowName && <span className="text-muted-foreground">{c.workflowName}</span>}
              {c.state && <RuntimeStatusBadge status={c.state} />}
            </>
          );
          const cls = 'flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-left text-sm';
          return (
            <li key={`${c.runtimeLabel}:${i}`}>
              {here ? (
                <button type="button" aria-label={`Open ${c.runtimeLabel}`} className={`${cls} hover:bg-muted`}
                  onClick={() => { void navigate({ to: '/wc/$wcId/running/$runtimeId', params: { wcId: wc.id, runtimeId: c.open!.id } }); }}>
                  {body}
                </button>
              ) : <div className={cls}>{body}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
