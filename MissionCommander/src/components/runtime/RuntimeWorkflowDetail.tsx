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
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';
import { useMissionSystemCommander } from '@/stores/principalStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { ApiError, apiErrorMessage } from '@/lib/api/client';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { RUNTIME_CAN, RUNTIME_TERMINAL } from '@/lib/runtime-status';
import { RuntimeStatusBadge } from './RuntimeStatusBadge';
import { AssignClaimDialog } from './AssignClaimDialog';
import { RuntimeDiagramCard } from './RuntimeDiagramCard';
import { LiveCreatedRuntimes } from './CreatedRuntimesSection';
import { RuntimeDialogStack } from './RuntimeDialogStack';
import { RuntimeResourcesSection, RuntimeValuePropertiesSection } from './RuntimeSharedStateSections';
import { SignaturesSection } from './SignaturesSection';
import type { RuntimeWorkflowLiveDetail } from '@/lib/api/types';
import { ForceCompleteControl } from './ForceCompleteControl';
import { isForceCompletable } from './force-completable';

export const RUNTIME_PANE_POLL_MS = 2000;

type PendingConfirm =
  | { kind: 'stop' | 'abort' }
  | { kind: 'force-release'; assignmentId: string; stepName: string };
// detail === null means the instance vanished (finished + reaped, or deleted): the 404 is
// folded into the view so the pane shows a calm notice instead of an error-toast loop.
type PaneView = { detail: RuntimeWorkflowLiveDetail | null };

// The Runtime pane's detail (spec 2026-08-27 §4.3): overview + live diagram + state verbs
// + claims. Start/Delete are deliberately absent — they live on the per-WC Runtime tab,
// which also covers pending/finished instances.
export function RuntimeWorkflowDetail() {
  const id = useSelectionStore((s) => s.selectedRuntimeWorkflowId);
  const selectRuntimeWorkflow = useSelectionStore((s) => s.selectRuntimeWorkflow);
  const setHierarchy = useSelectionStore((s) => s.setHierarchy);
  const selectWorkCenter = useSelectionStore((s) => s.selectWorkCenter);

  const fetcher = useCallback(async (): Promise<PaneView> => {
    try {
      return { detail: await runtimeWorkflows.live(id!) };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return { detail: null };
      throw err;
    }
  }, [id]);
  const { view, loading, error, stale, refresh } = usePolledView(
    id ? `runtime-pane:${id}` : null, fetcher, 'Failed to load runtime workflow', RUNTIME_PANE_POLL_MS,
  );
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<{ assignmentId: string; stepName: string } | null>(null);
  const canCommand = useMissionSystemCommander(view?.detail?.summary.workCenterId ?? null);
  // A confirm captured against one status must not fire against another (dialog precedent).
  useEffect(() => { setConfirm(null); }, [view?.detail?.summary.status]);

  const act = async (fn: () => Promise<unknown>, ok: string, fail: string) => {
    setBusy(true);
    setConfirm(null);
    try { await fn(); toast.success(ok); refresh(); }
    catch (err) { toast.error(apiErrorMessage(err, fail)); refresh(); }
    finally { setBusy(false); }
  };

  if (loading && !view) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (error && !view) return <div className="p-4 text-sm text-destructive">Failed to load runtime workflow</div>;
  if (!view) return null;
  if (view.detail === null) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <p className="text-sm text-muted-foreground">This runtime workflow is no longer available.</p>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => selectRuntimeWorkflow(null)}>
            Back to Runtime
          </Button>
        </div>
      </div>
    );
  }

  const { summary: s, steps, signatures } = view.detail;
  const status = s.status;
  const rwName = s.runtimeLabel;
  const reason = canCommand ? undefined : 'Requires Mission System Commander';

  const actions: Array<{ key: string; label: string; enabled: boolean; run: () => void }> = [
    { key: 'pause', label: 'Pause', enabled: RUNTIME_CAN.pause.has(status), run: () => void act(() => runtimeWorkflows.pause(s.id), `${rwName} pausing`, 'Pause failed') },
    { key: 'resume', label: 'Resume', enabled: RUNTIME_CAN.resume.has(status), run: () => void act(() => runtimeWorkflows.resume(s.id), `${rwName} resuming`, 'Resume failed') },
    { key: 'stop', label: 'Request stop', enabled: RUNTIME_CAN.stop.has(status), run: () => setConfirm({ kind: 'stop' }) },
    { key: 'abort', label: 'Abort', enabled: RUNTIME_CAN.abort.has(status), run: () => setConfirm({ kind: 'abort' }) },
  ];

  const runConfirmed = () => {
    if (!confirm) return;
    switch (confirm.kind) {
      case 'force-release': {
        const { assignmentId } = confirm;
        void act(() => runtimeWorkflows.forceRelease(assignmentId), 'Claim released', 'Force release failed');
        break;
      }
      case 'stop':
        void act(() => runtimeWorkflows.stop(s.id), `${rwName} stopping`, 'Stop failed');
        break;
      case 'abort':
        void act(() => runtimeWorkflows.abort(s.id), `${rwName} aborting`, 'Abort failed');
        break;
      default: {
        const _exhaustive: never = confirm;
        throw new Error(`RuntimeWorkflowDetail: unhandled confirm kind ${JSON.stringify(_exhaustive)}`);
      }
    }
  };
  const confirmLabel = confirm?.kind === 'force-release'
    ? `Release the claim on “${confirm.stepName}”?`
    : confirm ? `${confirm.kind === 'stop' ? 'Stop' : 'Abort'} ${rwName}?` : '';

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="space-y-1">
        <div className="text-sm text-muted-foreground">Runtime ›</div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{rwName} {s.masterName}</h1>
          <span className="text-muted-foreground">v{s.masterVersion}</span>
          <RuntimeStatusBadge status={status} />
        </div>
      </div>

      {stale && (
        <p className="text-xs text-muted-foreground" role="status">Live view unavailable — showing last known state</p>
      )}

      <div className="flex flex-wrap gap-1">
        {actions.map((a) => (
          <RequiresTooltip key={a.key} reason={reason}>
            <Button type="button" variant="ghost" size="sm"
              aria-label={`${a.label} ${rwName}`}
              disabled={!canCommand || !a.enabled || busy}
              title={reason}
              onClick={a.run}>
              {a.label}
            </Button>
          </RequiresTooltip>
        ))}
      </div>
      {confirm && (
        <div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-sm">
          <span>{confirmLabel}</span>
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={runConfirmed}>Confirm</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(null)}>Cancel</Button>
        </div>
      )}

      <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
        <dt className="text-muted-foreground">Master</dt><dd>{s.masterName} v{s.masterVersion} ({s.masterState})</dd>
        <dt className="text-muted-foreground">Created</dt><dd>{new Date(s.createdAt).toLocaleString()}{s.createdByName ? ` · ${s.createdByName}` : ''}</dd>
        {s.createdByLabel && (<><dt className="text-muted-foreground">Created by runtime</dt><dd>{s.createdByLabel}</dd></>)}
        {s.queuedAt && (<><dt className="text-muted-foreground">Queued</dt><dd>{new Date(s.queuedAt).toLocaleString()}</dd></>)}
        {s.startedAt && (<><dt className="text-muted-foreground">Started</dt><dd>{new Date(s.startedAt).toLocaleString()}</dd></>)}
        {s.completedAt && (<><dt className="text-muted-foreground">Finished</dt><dd>{new Date(s.completedAt).toLocaleString()}</dd></>)}
        <dt className="text-muted-foreground">Work center</dt>
        <dd>
          <button type="button" className="text-left underline-offset-2 hover:underline"
            onClick={() => { setHierarchy('work_center'); selectWorkCenter(s.workCenterId); }}>
            Open work center
          </button>
        </dd>
      </dl>

      <LiveCreatedRuntimes instanceId={s.id} onOpen={(t) => {
        if (t.kind === 'live') { setHierarchy('runtime'); selectRuntimeWorkflow(t.id); }
        else setHistoryId(t.id);
      }} />

      <RuntimeDiagramCard instanceId={s.id} canCommand={canCommand} busy={busy}
        onAssign={(assignmentId, stepName) => setAssignFor({ assignmentId, stepName })}
        onForceRelease={(assignmentId, stepName) => setConfirm({ kind: 'force-release', assignmentId, stepName })} />

      <RuntimeResourcesSection instanceId={s.id} workCenterId={s.workCenterId} />

      <div className="space-y-1">
        <h3 className="text-sm font-medium">Active steps</h3>
        {steps.length === 0 && <p className="text-sm text-muted-foreground">No steps yet</p>}
        {steps.map((st) => (
          <div key={st.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{st.stepName ?? st.stepOid}
              <span className="ml-1 text-xs text-muted-foreground">{st.stepType}</span>
            </span>
            <span className="text-xs uppercase text-muted-foreground">{st.state}</span>
            {st.assignment?.claimant && (
              <span className="flex items-center gap-1 text-xs">
                <span aria-hidden className={`size-2 rounded-full ${st.assignment.claimant.presence === 'online' ? 'bg-emerald-500' : st.assignment.claimant.presence === 'away' ? 'bg-amber-500' : 'bg-muted-foreground'}`} />
                {st.assignment.claimant.name ?? 'unknown'}
                <span className="sr-only">({st.assignment.claimant.presence})</span>
              </span>
            )}
            {st.assignment?.status === 'offered' && !RUNTIME_TERMINAL.has(status) && (
              <RequiresTooltip reason={reason}>
                <Button type="button" variant="ghost" size="sm"
                  aria-label={`Assign ${st.stepName ?? st.stepOid}`}
                  disabled={!canCommand || busy} title={reason}
                  onClick={() => setAssignFor({ assignmentId: st.assignment!.id, stepName: st.stepName ?? st.stepOid })}>
                  Assign…
                </Button>
              </RequiresTooltip>
            )}
            {st.assignment?.status === 'claimed' && !RUNTIME_TERMINAL.has(status) && (
              <RequiresTooltip reason={reason}>
                <Button type="button" variant="ghost" size="sm"
                  aria-label={`Force release ${st.stepName ?? st.stepOid}`}
                  disabled={!canCommand || busy} title={reason}
                  onClick={() => setConfirm({ kind: 'force-release', assignmentId: st.assignment!.id, stepName: st.stepName ?? st.stepOid })}>
                  Force release
                </Button>
              </RequiresTooltip>
            )}
            {isForceCompletable(st.stepType, st.state) && !RUNTIME_TERMINAL.has(status) && (
              <RequiresTooltip reason={reason}>
                <ForceCompleteControl instanceId={s.id} stepInstanceId={st.id} stepName={st.stepName ?? st.stepOid}
                  disabled={!canCommand || busy} title={reason} timer={st.gateTimer ?? undefined} onDone={refresh} />
              </RequiresTooltip>
            )}
            {st.error && <span className="truncate text-xs text-destructive" title={st.error}>{st.error}</span>}
          </div>
        ))}
      </div>

      <SignaturesSection signatures={signatures} />

      <RuntimeValuePropertiesSection instanceId={s.id} workCenterId={s.workCenterId} />

      {historyId && (
        <RuntimeDialogStack initial={{ kind: 'history', id: historyId }} onClose={() => setHistoryId(null)} />
      )}

      {assignFor && (
        <AssignClaimDialog assignmentId={assignFor.assignmentId} stepName={assignFor.stepName}
          onClose={() => setAssignFor(null)} onAssigned={refresh} />
      )}
    </div>
  );
}
