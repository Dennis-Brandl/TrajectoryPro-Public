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
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { workCenters } from '@/lib/api/work-centers';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { Button } from '@mission/ui';
import { cn } from '@/lib/utils';
import { useLayout } from '~/lib/layout';
import { useWorkCenter } from '~/components/shell/WorkCenterShell';
import { useSplitView } from '~/components/running/useSplitView';
import { StartForm } from './StartForm';
import { WorkflowPicker } from './WorkflowPicker';
import { useStartFormStore } from './startFormStore';

const REFRESH_MS = 60_000;

export function NewView({ selectedId }: { selectedId?: string }) {
  const wc = useWorkCenter();
  const navigate = useNavigate();
  const layout = useLayout();
  const split = useSplitView();
  const { view, loading, error } = usePolledView(
    wc.id, () => workCenters.get(wc.id), 'Could not load workflows', REFRESH_MS,
  );

  // Typed values are kept per workflow, so moving between New's own routes loses nothing;
  // leaving New with typed values asks first (as Commander's dialog does).
  useBlocker({
    shouldBlockFn: ({ next }) => {
      if (next.routeId.startsWith('/_xo/wc/$wcId/new')) return false;
      const { values, clear } = useStartFormStore.getState();
      const typed = Object.keys(values).filter((id) => Object.values(values[id]).some((v) => v !== ''));
      if (typed.length === 0) return false;
      if (!window.confirm('Discard entered parameter values?')) return true;
      Object.keys(values).forEach(clear);
      return false;
    },
    enableBeforeUnload: () => Object.values(useStartFormStore.getState().values).some((v) => Object.values(v).some((x) => x !== '')),
  });

  const workflows = view?.workflows ?? [];
  const selected = workflows.find((w) => w.id === selectedId);
  const choose = (id: string) => {
    void navigate({ to: '/wc/$wcId/new/$workflowId', params: { wcId: wc.id, workflowId: id } });
  };

  const list = (
    <div className="h-full overflow-auto p-4">
      <WorkflowPicker workflows={workflows} selectedId={selectedId} onSelect={choose} />
      {loading && !view && <p className="py-6 text-sm text-muted-foreground">Loading…</p>}
      {error && !view && <p className="py-6 text-sm text-destructive">{error}</p>}
      {view && workflows.length === 0 && <p className="py-6 text-sm text-muted-foreground">No workflows are loaded in this work center.</p>}
    </div>
  );
  const form = selected ? (
    <div className="p-4">
      {!split && (
        <Button variant="ghost" className="mb-3 min-h-11 gap-1 px-2" onClick={() => void navigate({ to: '/wc/$wcId/new', params: { wcId: wc.id } })}>
          <ArrowLeft className="size-4" aria-hidden /> Back
        </Button>
      )}
      <StartForm key={selected.id} workflow={selected} />
    </div>
  ) : (
    <div className="p-6 text-muted-foreground">{selectedId && loading ? 'Loading…' : 'Choose a workflow to start.'}</div>
  );

  if (split) {
    return (
      <div className="flex h-full min-h-0">
        <div className={cn('shrink-0 border-r border-border', layout === 'desktop' ? 'w-[400px] min-w-[360px]' : 'w-[420px]')}>{list}</div>
        <div className="min-w-0 flex-1 overflow-auto">{form}</div>
      </div>
    );
  }
  return <div className="h-full min-h-0 overflow-auto">{selectedId ? form : list}</div>;
}
