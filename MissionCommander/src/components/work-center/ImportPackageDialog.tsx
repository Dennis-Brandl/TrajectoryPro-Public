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
import { useState } from 'react';
import { packages } from '@/lib/api/package';
import { ApiError, apiErrorMessage } from '@/lib/api/client';
import type { ImportReport } from '@/lib/api/types';
import { useHasRight } from '@/stores/principalStore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';
import { WorkCenterSelect } from './WorkCenterSelect';

type Mode = 'create' | 'merge';

/**
 * The 409 body is { error: { code, message, impact } } — same envelope as the work-center
 * delete preflight (DeleteWorkCenterDialog's impactOf). Narrowed defensively: a merge that
 * fails for some OTHER reason (a malformed package, a 403 from the edit-right gate) must fall
 * through to the plain error banner, not render an empty impact.
 */
function mergeImpactOf(err: unknown): ImportReport | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const impact = (err.body as { error?: { impact?: ImportReport } } | undefined)?.error?.impact;
  return impact && typeof impact.rootWorkCenterId === 'string' ? impact : null;
}

/**
 * Errors and results are rendered INLINE here rather than via toast, which is how LoadDialog
 * reports failure. The divergence is deliberate: this dialog already needs an inline results
 * region for the counts, and its most likely failure — a 409 because the root work-center
 * name is taken (create) or confirmation is required (merge) — requires the steward to ACT
 * (pick a different parent, or read the preview and confirm). A toast that fades cannot
 * support that.
 */
export function ImportPackageDialog({ open, onOpenChange, onImported }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported: (report: ImportReport) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  // The rolled-back preview report (409), rendered before anything is applied. Distinct from
  // `report` below: `impact` is what a merge WOULD do, `report` is what actually happened.
  const [impact, setImpact] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Display-only gating: the route checks work_center:edit ONLY on the merge branch (spec
  // §8.9), so a principal without it must never even reach the target picker or fire a
  // preview that the server would 403 anyway. The server re-checks regardless.
  const canMerge = useHasRight('work_center:edit');

  const pickFile = (f: File | null) => {
    setFile(f);
    // A new (or cleared) file invalidates any in-progress choice — a stale mode, target or
    // preview from a previous file must not silently carry over onto this one.
    setMode(null); setParentId(null); setTargetId(null);
    setImpact(null); setReport(null); setError(null);
  };

  const chooseMode = (m: Mode) => {
    setMode(m);
    setImpact(null); setReport(null); setError(null);
  };

  const pickTarget = (id: string | null) => {
    setTargetId(id);
    // A changed target makes any existing preview stale — it described resolution against
    // the OLD target.
    setImpact(null);
  };

  const runCreate = async () => {
    if (!file) return;
    setBusy(true); setError(null); setReport(null);
    try {
      const result = await packages.import(file, { mode: 'create', parentWorkCenterId: parentId });
      setReport(result);
      onImported(result);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not import the package.'));
    } finally {
      setBusy(false);
    }
  };

  const previewMerge = async () => {
    if (!file || !targetId) return;
    setBusy(true); setError(null); setImpact(null); setReport(null);
    try {
      // The server always answers an unconfirmed merge with a 409 (spec §8.9) — a plain 200
      // here would mean the route's contract changed underneath this dialog, so it is
      // treated as an error rather than silently applied.
      await packages.import(file, { mode: 'merge', targetWorkCenterId: targetId, confirmed: false });
      setError('The server applied the merge without asking for confirmation.');
    } catch (err) {
      const preview = mergeImpactOf(err);
      if (preview) setImpact(preview);
      else setError(apiErrorMessage(err, 'Could not preview the merge.'));
    } finally {
      setBusy(false);
    }
  };

  const applyMerge = async () => {
    if (!file || !targetId) return;
    setBusy(true); setError(null);
    try {
      const result = await packages.import(file, { mode: 'merge', targetWorkCenterId: targetId, confirmed: true });
      setImpact(null);
      setReport(result);
      onImported(result);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not apply the merge.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          {/*
            Product copy wins over test convenience: this title names WHAT is imported, not
            just the result, so it keeps the word "package" even though that once collided with
            a loose test query. Radix's DialogContent wires aria-labelledby on the outer
            role="dialog" wrapper to this title, and RTL's getByLabelText scans every element
            carrying aria-labelledby (not just form controls) — so a substring regex query like
            /package/i matches BOTH the file input's "Package" label and this dialog wrapper,
            once the wrapper's labelled text also contains "package". Per project convention,
            the fix belongs in the test (an exact `getByLabelText('Package')`, or
            `{ selector: 'input' }`), never in this copy. Do not reword this title to dodge a
            test query again — tighten the query instead.
          */}
          <DialogTitle>Import a work-center package</DialogTitle>
          <DialogDescription>
            Create loads the package as a new work center. Merge instead resolves it against an
            existing one — matched work centers and workflow entries are updated in place — and
            shows a preview of every change before anything is written.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label htmlFor="import-package">Package</Label>
          <Input id="import-package" type="file" accept=".WFcenterX"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        </div>

        {file && (
          <div className="space-y-1">
            <Label>Import as</Label>
            <div className="flex gap-2">
              <Button type="button" variant={mode === 'create' ? 'default' : 'outline'}
                disabled={busy} onClick={() => chooseMode('create')}>
                Create new work center
              </Button>
              <RequiresTooltip reason={canMerge ? undefined : 'Requires work_center:edit'}>
                <Button type="button" variant={mode === 'merge' ? 'default' : 'outline'}
                  disabled={busy || !canMerge}
                  title={canMerge ? undefined : 'Requires work_center:edit'}
                  onClick={() => chooseMode('merge')}>
                  Merge into existing work center
                </Button>
              </RequiresTooltip>
            </div>
          </div>
        )}

        {mode === 'create' && (
          <WorkCenterSelect id="import-parent" label="Parent work center" allowRoot
            rootLabel="(as a new root)"
            value={parentId} onChange={setParentId} />
        )}
        {mode === 'merge' && (
          <WorkCenterSelect id="import-target" label="Target work center"
            value={targetId} onChange={pickTarget} />
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {impact && <ImportReportSummary report={impact} heading="This merge would" />}
        {report && <ImportReportSummary report={report} heading={mode === 'merge' ? 'Merge applied' : undefined} />}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {report ? 'Done' : 'Cancel'}
          </Button>
          {mode === 'create' && (
            <Button type="button" onClick={runCreate} disabled={busy || !file}>Import</Button>
          )}
          {mode === 'merge' && !impact && !report && (
            <Button type="button" onClick={previewMerge} disabled={busy || !file || !targetId}>
              Preview merge
            </Button>
          )}
          {mode === 'merge' && impact && (
            <Button type="button" onClick={applyMerge} disabled={busy}>Merge</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Shared between the rolled-back preview (`impact`) and the applied result (`report`) — both
 * are the same ImportReport shape (spec §8.6), so one renderer covers both. Order matches the
 * brief: config changes first, then target-only grants, then counts, then unresolved grants
 * and export warnings.
 */
function ImportReportSummary({ report, heading }: { report: ImportReport; heading?: string }) {
  return (
    <div className="space-y-2 text-sm">
      {heading && <p className="font-medium">{heading}</p>}

      {report.configChanges.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium">Config changes</p>
          <ul className="space-y-0.5">
            {/* Keyed by index: two identical override rows are legitimate and would collide
                on any derived string key. */}
            {report.configChanges.map((c, i) => (
              <li key={i}>
                {c.workCenterPath}{c.workflow ? ` — ${c.workflow.oid}@${c.workflow.version}` : ''}: {c.field}{' '}
                {String(c.from)} → {String(c.to)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.targetOnlyGrants.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium">Grants only on the target (kept, not removed)</p>
          <ul className="space-y-0.5">
            {report.targetOnlyGrants.map((g, i) => (
              <li key={i}>{g.role} on {g.nodePath} in {g.workCenterPath}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-muted-foreground">
        {report.workCenters.created} work centers created
        {report.workCenters.matched > 0 && ` · ${report.workCenters.matched} matched`} ·{' '}
        {report.workflows.created} workflows ({report.workflows.alreadyPresent} already present) ·{' '}
        {report.environments.created} environments ({report.environments.alreadyPresent} already present) ·{' '}
        {report.links.created} links ({report.links.alreadyPresent} already present) ·{' '}
        {report.roles.created} roles ·{' '}
        {report.grants.created} role grants ({report.grants.alreadyPresent} already present)
      </p>

      {report.grants.unresolved.length > 0 && (
        <div className="space-y-1 text-destructive">
          <p>These role grants could not be applied:</p>
          {/* Keyed by index, not by string: two identical messages would collide. */}
          <ul>{report.grants.unresolved.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </div>
      )}

      {report.warnings.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium">Warnings carried over from export</p>
          <ul>{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
