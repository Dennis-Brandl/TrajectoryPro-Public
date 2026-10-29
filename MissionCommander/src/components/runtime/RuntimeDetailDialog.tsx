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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';
import { useMissionSystemCommander } from '@/stores/principalStore';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { apiErrorMessage } from '@/lib/api/client';
import { usePolledView } from '@/lib/hooks/usePolledView';
import { RUNTIME_DELETABLE, RUNTIME_CAN, RUNTIME_TERMINAL } from '@/lib/runtime-status';
import { RuntimeStatusBadge } from './RuntimeStatusBadge';
import { LiveCreatedRuntimes } from './CreatedRuntimesSection';
import type { CreatedRuntimeTarget } from '@/lib/api/types';
import { SignaturesSection } from './SignaturesSection';
import { ForceCompleteControl } from './ForceCompleteControl';
import { isForceCompletable } from './force-completable';

export const RUNTIME_DETAIL_POLL_MS = 2000;

type PendingConfirm =
  | { kind: 'stop' | 'abort' | 'delete' }
  | { kind: 'force-release'; assignmentId: string; stepName: string };

export function RuntimeDetailDialog({ id, onClose, onOpenChild, back }: {
  id: string; onClose: () => void;
  onOpenChild?: (target: CreatedRuntimeTarget, fromLabel: string) => void;
  back?: { label: string; onBack: () => void };
}) {
  const fetcher = useCallback(() => runtimeWorkflows.live(id), [id]);
  const { view, loading, error, stale, refresh } = usePolledView(`live:${id}`, fetcher, 'Failed to load runtime workflow', RUNTIME_DETAIL_POLL_MS);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const canCommand = useMissionSystemCommander(view?.summary.workCenterId ?? null);
  // A confirm captured against one status must not fire against another; the server 409
  // remains the backstop. (`view?.summary.status`, not the narrowed `status` const below,
  // since a hook dependency must be declared before the `if (!view)` early return.)
  useEffect(() => { setConfirm(null); }, [view?.summary.status]);

  const act = async (fn: () => Promise<unknown>, ok: string, fail: string, closes = false) => {
    setBusy(true);
    setConfirm(null);
    try { await fn(); toast.success(ok); if (closes) onClose(); else refresh(); }
    catch (err) { toast.error(apiErrorMessage(err, fail)); refresh(); }
    finally { setBusy(false); }
  };

  if (!view) {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Runtime workflow</DialogTitle>
            <DialogDescription className="sr-only">Live monitoring and controls for this runtime workflow.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{loading ? 'Loading…' : error ?? 'Not found'}</p>
        </DialogContent>
      </Dialog>
    );
  }

  const s = view.summary;
  const status = s.status;
  const rwName = s.runtimeLabel;
  const reason = canCommand ? undefined : 'Requires Mission System Commander';

  const actions: Array<{ key: string; label: string; enabled: boolean; run: () => void }> = [
    { key: 'start', label: 'Start', enabled: RUNTIME_CAN.start.has(status), run: () => void act(() => runtimeWorkflows.start(s.id), `${rwName} starting`, 'Start failed') },
    { key: 'pause', label: 'Pause', enabled: RUNTIME_CAN.pause.has(status), run: () => void act(() => runtimeWorkflows.pause(s.id), `${rwName} pausing`, 'Pause failed') },
    { key: 'resume', label: 'Resume', enabled: RUNTIME_CAN.resume.has(status), run: () => void act(() => runtimeWorkflows.resume(s.id), `${rwName} resuming`, 'Resume failed') },
    { key: 'stop', label: 'Request stop', enabled: RUNTIME_CAN.stop.has(status), run: () => setConfirm({ kind: 'stop' }) },
    { key: 'abort', label: 'Abort', enabled: RUNTIME_CAN.abort.has(status), run: () => setConfirm({ kind: 'abort' }) },
    { key: 'delete', label: 'Delete', enabled: RUNTIME_DELETABLE.has(status), run: () => setConfirm({ kind: 'delete' }) },
  ];

  const runConfirmed = () => {
    if (!confirm) return;
    // Exhaustive switch on the discriminant: TS narrows `confirm` per case natively (no
    // if-chain narrowing quirks to work around), and the `default` arm's `never` assignment
    // makes a future 5th PendingConfirm kind a COMPILE ERROR here instead of a silent no-op.
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
      case 'delete':
        void act(() => runtimeWorkflows.remove(s.id), `${rwName} deleted`, 'Delete failed', true);
        break;
      default: {
        const _exhaustive: never = confirm;
        throw new Error(`RuntimeDetailDialog: unhandled confirm kind ${JSON.stringify(_exhaustive)}`);
      }
    }
  };
  const confirmLabel = confirm?.kind === 'force-release'
    ? `Release the claim on “${confirm.stepName}”?`
    : confirm ? `${confirm.kind === 'stop' ? 'Stop' : confirm.kind === 'abort' ? 'Abort' : 'Delete'} ${rwName}?` : '';

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {back && <Button type="button" variant="link" size="sm" onClick={back.onBack}>Back to {back.label}</Button>}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {rwName} · {s.masterName} <span className="font-normal text-muted-foreground">v{s.masterVersion}</span>
            <RuntimeStatusBadge status={status} />
          </DialogTitle>
          <DialogDescription>Live monitoring and controls for this runtime workflow.</DialogDescription>
        </DialogHeader>

        <div className="text-xs text-muted-foreground">
          Created {new Date(s.createdAt).toLocaleString()}
          {s.startedAt ? ` · Started ${new Date(s.startedAt).toLocaleString()}` : ''}
          {s.completedAt ? ` · Finished ${new Date(s.completedAt).toLocaleString()}` : ''}
          {s.createdByName ? ` · ${s.createdByName}` : ''}
          {s.createdByLabel ? ` · Created by ${s.createdByLabel}` : ''}
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

        {onOpenChild && <LiveCreatedRuntimes instanceId={s.id} onOpen={(t) => onOpenChild(t, s.runtimeLabel)} />}

        <div className="space-y-1">
          <h3 className="text-sm font-medium">Steps</h3>
          {view.steps.length === 0 && <p className="text-sm text-muted-foreground">No steps yet</p>}
          {view.steps.map((st) => (
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

        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setTraceOpen((v) => !v)}>
            {traceOpen ? 'Hide trace' : `Show trace (${view.trace.length})`}
          </Button>
          {traceOpen && (
            <ol className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {view.trace.map((t, i) => (
                <li key={i}>
                  {new Date(t.at).toLocaleTimeString()} · {t.stepName ?? t.stepOid ?? '—'} · {t.state}
                  {t.error ? ` · ${t.error}` : ''}
                </li>
              ))}
            </ol>
          )}
        </div>

        <SignaturesSection signatures={view.signatures} />
      </DialogContent>
    </Dialog>
  );
}
