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
import { useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { apiErrorMessage } from '@/lib/api/client';
import type { RuntimeParameterSpec, WorkflowWithRoleCount } from '@/lib/api/types';
import { initialParamValues, paramsForCreate } from '@/lib/runtime-params';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { Button } from '@mission/ui';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useLayout } from '~/lib/layout';
import { VIEW_ONLY_TEXT } from '~/lib/view-only';
import { useWorkCenter } from '~/components/shell/WorkCenterShell';
import { useConnection } from '~/components/running/connection';
import { useStartFormStore } from './startFormStore';
import { StateBadge } from './WorkflowPicker';

const REFRESH_MS = 300_000;

export function StartForm({ workflow }: { workflow: WorkflowWithRoleCount }) {
  const wc = useWorkCenter();
  const navigate = useNavigate();
  const phone = useLayout() === 'phone';
  const { offline } = useConnection();
  const { view, loading, error } = usePolledView(
    workflow.id,
    () => runtimeWorkflows.parameters(workflow.id),
    'Could not load parameters',
    REFRESH_MS,
  );
  const stored = useStartFormStore((s) => s.values[workflow.id]);
  const setStored = useStartFormStore((s) => s.set);
  const clear = useStartFormStore((s) => s.clear);
  const [starting, setStarting] = useState(false);
  const inFlight = useRef(false);

  const specs: RuntimeParameterSpec[] = view?.parameters ?? [];
  const values = stored ?? initialParamValues(specs);
  const viewOnly = wc.mode === 'view-only';
  const disabled = viewOnly || offline || loading || view === null || starting;

  const start = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStarting(true);
    try {
      const rw = await runtimeWorkflows.create(workflow.id, paramsForCreate(values), { start: true });
      clear(workflow.id);
      toast.success(`${rw.runtimeLabel} started`);
      void navigate({ to: '/wc/$wcId/running/$runtimeId', params: { wcId: wc.id, runtimeId: rw.id } });
    } catch (err) {
      // Only a failure re-enables Start; after success it stays off until navigation leaves the form.
      toast.error(apiErrorMessage(err, 'Start failed'));
      inFlight.current = false;
      setStarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{workflow.name} needs</h2>
      {loading && !view && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && !view && <p className="text-sm text-destructive">{error}</p>}
      {view && specs.length === 0 && <p className="text-sm text-muted-foreground">No starting parameters.</p>}
      {specs.map((p) => (
        <div key={p.id} className="space-y-1">
          <Label htmlFor={`param-${p.id}`}>{p.id}</Label>
          {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
          <Input
            id={`param-${p.id}`}
            className="h-11"
            value={values[p.id] ?? ''}
            placeholder={p.valueType === 'property' ? `Resolved at start: ${p.defaultValue}` : undefined}
            disabled={viewOnly}
            onChange={(e) => setStored(workflow.id, { ...values, [p.id]: e.target.value })}
          />
        </div>
      ))}
      {workflow.state !== 'Released' && <div><StateBadge state={workflow.state} /></div>}
      {viewOnly && <p className="text-sm text-muted-foreground">{VIEW_ONLY_TEXT}</p>}
      <div className={cn('flex', !phone && 'justify-end')}>
        <Button className={cn(phone ? 'h-[52px] w-full' : 'min-h-11 px-6')} disabled={disabled} onClick={() => void start()}>
          Start
        </Button>
      </div>
    </div>
  );
}
