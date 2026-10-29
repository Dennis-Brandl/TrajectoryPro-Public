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
import { FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';
import { useMissionSystemCommander, usePrincipalStore } from '@/stores/principalStore';
import { runtimeHistory } from '@/lib/api/runtime-history';
import { apiErrorMessage } from '@/lib/api/client';
import { useResourceView } from '@/lib/hooks/useResourceView';
import { RuntimeStatusBadge } from '@/components/runtime/RuntimeStatusBadge';
import { SignaturesSection } from '@/components/runtime/SignaturesSection';
import { StaticCreatedRuntimes } from '@/components/runtime/CreatedRuntimesSection';
import { formatDuration } from './format-duration';
import { activationRunNumbers, stepRunPathText } from './record/step-run-labels';
import type { CreatedRuntimeTarget, RuntimeHistoryDetail } from '@/lib/api/types';

/** A key/value map rendered as a definition-list; falls back to "None" for an empty or null
 *  map, matching the app-wide "no value" convention rather than showing a bare empty list. */
function KeyValueRows({ values }: { values: Record<string, string> | null }) {
  const entries = values ? Object.entries(values) : [];
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">None</p>;
  return (
    <dl className="mt-1 space-y-0.5 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="text-muted-foreground">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The Inputs / Outputs pair under a step heading; a side that is `undefined` is omitted. */
function StepParamBlocks({ inputs, outputs }: {
  inputs: Record<string, string> | null | undefined; outputs: Record<string, string> | null | undefined;
}) {
  return (
    <>
      {inputs !== undefined && (
        <div className="mt-0.5">
          <span className="text-muted-foreground">Inputs</span>
          <KeyValueRows values={inputs} />
        </div>
      )}
      {outputs !== undefined && (
        <div className="mt-0.5">
          <span className="text-muted-foreground">Outputs</span>
          <KeyValueRows values={outputs} />
        </div>
      )}
    </>
  );
}

/** History detail dialog (phase 7 Task 7). History rows are immutable once written — this
 *  fetches ONCE via `useResourceView` (no polling, unlike the live `RuntimeDetailDialog`)
 *  and the trace renders FLAT, in the order the server returned it: each entry is its own
 *  line (name/oid, state, timestamp, error), with no start/end pairing and no per-step
 *  duration — only the run-level header carries a duration (started -> finished). */
export function HistoryDetailDialog({ id, onClose, onDeleted, onOpenChild, back }: {
  id: string; onClose: () => void; onDeleted: () => void;
  onOpenChild?: (target: CreatedRuntimeTarget, fromLabel: string) => void;
  back?: { label: string; onBack: () => void };
}) {
  const { view, loading, error } = useResourceView<RuntimeHistoryDetail>(
    id, () => runtimeHistory.detail(id), 'Failed to load history entry',
  );
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const pdfRunning = useRef(false); // closes the gap before the disabled re-render lands
  const [confirming, setConfirming] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [startingParamsOpen, setStartingParamsOpen] = useState(false);
  const [stepParamsOpen, setStepParamsOpen] = useState(false);

  // useMissionSystemCommander already returns true for an administrator, but ONLY when a
  // work-center id is supplied (it short-circuits false on a null/undefined id) — so an
  // orphan row (work center since deleted) needs `isAdmin` checked directly, or an
  // administrator would be wrongly locked out of the one class of row only they can act on.
  const principal = usePrincipalStore((s) => s.principal);
  const isAdmin = principal?.isAdministrator ?? false;
  const workCenterId = view?.workCenterId ?? null;
  const isSystemCommander = useMissionSystemCommander(workCenterId);
  const canDelete = isAdmin || (workCenterId != null && isSystemCommander);
  const reason = canDelete ? undefined : 'Requires administrator or Mission System Commander';

  if (!view) {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>History entry</DialogTitle>
            <DialogDescription className="sr-only">Details for a completed runtime workflow.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{loading ? 'Loading…' : error ?? 'Not found'}</p>
        </DialogContent>
      </Dialog>
    );
  }

  const rwName = view.runtimeLabel;
  const stepName = (oid: string) => view.stepNames?.[oid] ?? oid;
  // A child step's run count restarts with each run of its sub-workflow, as in the PDF.
  const runNumbers = activationRunNumbers(view.stepRuns);

  // The PDF modules (and jsPDF behind them) load on the first click, not with the main bundle.
  const handleDownloadPdf = async () => {
    if (pdfRunning.current) return;
    pdfRunning.current = true;
    setPdfBusy(true);
    try {
      const [{ buildRecordModel, pdfFileName }, { renderRecordPdf }] = await Promise.all([
        import('./record/record-model'), import('./record/record-pdf'),
      ]);
      const model = buildRecordModel(view, {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        now: new Date(),
        loginName: principal?.loginName ?? 'unknown',
      });
      renderRecordPdf(model).doc.save(pdfFileName(view));
    } catch (err) {
      console.error('[history] PDF export failed:', err);
      toast.error('Could not create the PDF');
    } finally {
      pdfRunning.current = false;
      setPdfBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setConfirming(false);
    try {
      await runtimeHistory.remove(id);
      toast.success(`${rwName} deleted`);
      onDeleted();
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Delete failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {back && <Button type="button" variant="link" size="sm" onClick={back.onBack}>Back to {back.label}</Button>}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {rwName} · {view.masterName} <span className="font-normal text-muted-foreground">v{view.masterVersion}</span>
            <RuntimeStatusBadge status={view.finalState} />
          </DialogTitle>
          <DialogDescription>Details for a completed runtime workflow.</DialogDescription>
        </DialogHeader>

        <div>
          <Button type="button" variant="outline" size="sm" disabled={pdfBusy} onClick={() => void handleDownloadPdf()}>
            <FileDown /> {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}
          </Button>
        </div>

        <div className="text-xs text-muted-foreground">
          {view.workCenterName}
          {' · '}Started {view.startedAt ? new Date(view.startedAt).toLocaleString() : '—'}
          {' · '}Finished {new Date(view.finishedAt).toLocaleString()}
          {' · '}{formatDuration(view.startedAt, view.finishedAt)}
          {view.createdByLabel ? <>{' · '}Created by {view.createdByLabel}</> : null}
        </div>

        {onOpenChild && view.workflowInstanceId && (
          <StaticCreatedRuntimes instanceId={view.workflowInstanceId} onOpen={(t) => onOpenChild(t, view.runtimeLabel)} />
        )}

        <div className="space-y-1">
          <h3 className="text-sm font-medium">Trace</h3>
          {view.trace.length === 0 && <p className="text-sm text-muted-foreground">No trace entries</p>}
          {view.trace.length > 0 && (
            <ol className="space-y-0.5 text-xs text-muted-foreground">
              {view.trace.map((t, i) => (
                <li key={i}>
                  {stepName(t.step_oid)} · {t.state} · {new Date(t.timestamp).toLocaleString()}
                  {t.error ? ` · ${t.error}` : ''}
                </li>
              ))}
            </ol>
          )}
        </div>

        <SignaturesSection signatures={view.signatures} />

        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPropertiesOpen((v) => !v)}>
            {propertiesOpen ? 'Hide properties' : 'Show properties'}
          </Button>
          {propertiesOpen && <KeyValueRows values={view.properties} />}
        </div>

        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setStartingParamsOpen((v) => !v)}>
            {startingParamsOpen ? 'Hide starting params' : 'Show starting params'}
          </Button>
          {startingParamsOpen && <KeyValueRows values={view.startingParams} />}
        </div>

        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setStepParamsOpen((v) => !v)}>
            {stepParamsOpen ? 'Hide step params' : 'Show step params'}
          </Button>
          {stepParamsOpen && (
            view.stepRuns.length > 0 ? (
              <div className="mt-1 space-y-2 text-xs">
                {view.stepRuns.map((r, i) => (
                  <div key={r.id}>
                    <div className="font-medium text-foreground">{`${r.stepName} #${runNumbers[i]}`}</div>
                    {r.nodePath.length > 0 && (
                      <div className="text-muted-foreground">{stepRunPathText(r)}</div>
                    )}
                    <StepParamBlocks inputs={r.inputParameters} outputs={r.outputParameters} />
                  </div>
                ))}
              </div>
            ) : Object.keys(view.stepParams ?? {}).length === 0 ? (
              <p className="text-xs text-muted-foreground">None</p>
            ) : (
              <div className="mt-1 space-y-2 text-xs">
                {Object.entries(view.stepParams ?? {}).map(([oid, params]) => (
                  <div key={oid}>
                    <div className="font-medium text-foreground">{stepName(oid)}</div>
                    <StepParamBlocks inputs={params.inputParameters} outputs={params.outputParameters} />
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {confirming && (
          <div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-sm">
            <span>Delete this history entry?</span>
            <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void handleDelete()}>Confirm</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        )}

        <DialogFooter>
          <RequiresTooltip reason={reason}>
            <Button type="button" variant="destructive" size="sm"
              disabled={!canDelete || busy} title={reason}
              onClick={() => setConfirming(true)}>
              Delete
            </Button>
          </RequiresTooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
