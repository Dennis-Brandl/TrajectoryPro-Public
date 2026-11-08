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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@mission/ui';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { ApiError } from '@/lib/api/client';
import type { RuntimeLiveStep, RuntimeWorkflowLiveDetail } from '@/lib/api/types';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { useNow } from '@/lib/hooks/useNow';
import { AssignClaimDialog } from '@/components/runtime/AssignClaimDialog';
import { RuntimeDiagramCard } from '@/components/runtime/RuntimeDiagramCard';
import { RuntimeStatusBadge } from '@/components/runtime/RuntimeStatusBadge';
import { SignaturesSection } from '@/components/runtime/SignaturesSection';
import { RUNTIME_TERMINAL } from '@/lib/runtime-status';
import { useMeStore } from '~/stores/meStore';
import { useLayout } from '~/lib/layout';
import { useWorkCenter } from '~/components/shell/WorkCenterShell';
import { ConfirmAction, SheetDialog } from './ConfirmAction';
import { ConnectionBanner } from './ConnectionBanner';
import { useConnection, useReportConnection } from './connection';
import { ForceCompleteForm } from './ForceCompleteForm';
import { ReadOnlySharedState } from './ReadOnlySharedState';
import { RuntimeChildren } from './RuntimeChildren';
import { RuntimeControls } from './RuntimeControls';
import { StepList } from './StepList';
import { reportControlError } from './controls';
import { useSplitView } from './useSplitView';

const POLL_MS = 2000;
type View = { detail: RuntimeWorkflowLiveDetail | null };

function formatStarted(iso: string | null): string | null {
  return iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null;
}

export function RuntimeDetail({ runtimeId }: { runtimeId: string }) {
  const wc = useWorkCenter();
  const navigate = useNavigate();
  const layout = useLayout();
  const split = useSplitView();
  const { offline } = useConnection();
  const report = useReportConnection();
  const nowMs = useNow(30000);
  const phone = layout === 'phone';

  // A runtime that vanished (finished and reaped, or deleted) is a calm notice, not an error loop.
  const fetcher = useCallback(async (): Promise<View> => {
    try { return { detail: await runtimeWorkflows.live(runtimeId) }; }
    catch (err) {
      if (err instanceof ApiError && err.status === 404) return { detail: null };
      throw err;
    }
  }, [runtimeId]);
  const { view, loading, error, stale, refresh } = usePolledView(`xo-live:${runtimeId}`, fetcher, 'Could not load the runtime', POLL_MS);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  useEffect(() => { if (view) setLastUpdatedAt(new Date()); }, [view]);
  const down = stale || (error !== null && view !== null);
  useEffect(() => { report(down, lastUpdatedAt); }, [report, down, lastUpdatedAt]);

  const [assignFor, setAssignFor] = useState<{ assignmentId: string; stepName: string } | null>(null);
  const [releaseFor, setReleaseFor] = useState<{ assignmentId: string; stepName: string } | null>(null);
  const [forceFor, setForceFor] = useState<RuntimeLiveStep | null>(null);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const assigned = useRef(false);

  const toList = () => { void navigate({ to: '/wc/$wcId/running', params: { wcId: wc.id } }); };
  const back = !split && (
    <Button variant="ghost" className="mb-3 min-h-11" onClick={toList}><ArrowLeft className="size-4" /> Back</Button>
  );
  const banner = !split && <ConnectionBanner stale={offline} lastUpdatedAt={lastUpdatedAt} />;

  if (!view) {
    return (
      <div>{banner}<div className="p-4">{back}
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div></div>
    );
  }
  if (view.detail === null) {
    return (
      <div>{banner}<div className="p-4">{back}
        <p className="text-sm text-muted-foreground">This runtime is no longer available.</p>
      </div></div>
    );
  }

  const detail = view.detail;
  const s = detail.summary;
  const canAct = wc.mode === 'full' && !offline;
  const startedAt = formatStarted(s.startedAt);
  const terminal = RUNTIME_TERMINAL.has(s.status);

  const release = async () => {
    if (!releaseFor || busy) return;
    setBusy(true);
    try {
      await runtimeWorkflows.forceRelease(releaseFor.assignmentId);
      toast.success('Claim released');
    } catch (err) { reportControlError(err, 'Force release failed'); }
    finally { setBusy(false); setReleaseFor(null); refresh(); }
  };

  const controls = (bar: boolean) => (
    <RuntimeControls detail={detail} mode={wc.mode} offline={offline} bar={bar} onChanged={refresh} onDeleted={toList} />
  );
  const diagram = (
    <RuntimeDiagramCard instanceId={s.id} canCommand={canAct} busy={busy}
      onAssign={(assignmentId, stepName) => setAssignFor({ assignmentId, stepName })}
      onForceRelease={(assignmentId, stepName) => setReleaseFor({ assignmentId, stepName })} />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {banner}
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {back}
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-semibold leading-tight">{s.masterName}</h1>
              <RuntimeStatusBadge status={s.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {[`${s.runtimeLabel} · v${s.masterVersion}`, startedAt ? `started ${startedAt}${s.createdByName ? ` by ${s.createdByName}` : ''}` : 'Not started yet'].join(' · ')}
            </p>
          </div>
          {!phone && controls(false)}
        </header>

        <StepList steps={detail.steps} runtimeTerminal={terminal} canAct={canAct} nowMs={nowMs}
          onAssign={(assignmentId, stepName) => setAssignFor({ assignmentId, stepName })}
          onForceRelease={(assignmentId, stepName) => setReleaseFor({ assignmentId, stepName })}
          onForceComplete={setForceFor} />

        {phone
          ? <Button type="button" variant="outline" className="min-h-12 w-full" onClick={() => setDiagramOpen(true)}>Diagram</Button>
          : diagram}

        <RuntimeChildren instanceId={s.id} />
        <ReadOnlySharedState instanceId={s.id} />
        <SignaturesSection signatures={detail.signatures} />
      </div>
      {phone && controls(true)}

      {assignFor && (
        <AssignClaimDialog assignmentId={assignFor.assignmentId} stepName={assignFor.stepName}
          onClose={() => { setAssignFor(null); if (!assigned.current) void useMeStore.getState().refresh().catch(() => {}); assigned.current = false; }}
          onAssigned={() => { assigned.current = true; refresh(); }} />
      )}
      <ConfirmAction open={releaseFor !== null} title="Force release?" destructive={false}
        body={`Release the claim on “${releaseFor?.stepName ?? ''}”?`} confirmLabel="Force release"
        busy={busy} onConfirm={() => void release()} onCancel={() => setReleaseFor(null)} />
      {forceFor && (
        <ForceCompleteForm instanceId={s.id} stepInstanceId={forceFor.id} stepName={forceFor.stepName ?? forceFor.stepOid}
          onClose={() => setForceFor(null)} onDone={refresh} />
      )}
      {phone && (
        <SheetDialog open={diagramOpen} onClose={() => setDiagramOpen(false)} title="Diagram"
          className="inset-0 h-dvh max-w-none translate-x-0 translate-y-0 overflow-auto rounded-none">
          {diagramOpen && diagram}
        </SheetDialog>
      )}
    </div>
  );
}
