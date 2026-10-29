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
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import type { LoadResult } from '@/lib/api/types';

const PILL: Record<LoadResult['status'], string> = {
  loaded: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  replaced: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  already_present: 'bg-muted text-muted-foreground',
  failed: 'bg-destructive/15 text-destructive',
};
const LABEL: Record<LoadResult['status'], string> = {
  loaded: 'loaded',
  replaced: 'replaced',
  already_present: 'already present',
  failed: 'failed',
};

function summarize(results: LoadResult[]): string {
  const n = (s: LoadResult['status']) => results.filter((r) => r.status === s).length;
  const pairs = results.length;
  const warnings = results.reduce((n, r) => n + (r.warnings?.length ?? 0), 0);
  const base = `${pairs} result${pairs === 1 ? '' : 's'} — `
    + `${n('loaded')} loaded, ${n('replaced')} replaced, ${n('already_present')} already present, ${n('failed')} failed`;
  return warnings === 0 ? base : `${base}, ${warnings} warning${warnings === 1 ? '' : 's'}`;
}

/**
 * Node paths arrive percent-escaped ('%'→%25 before '/'→%2F, spec §6.3) so a node literally
 * named 'Fill/Cap' cannot collide with a Fill→Cap nesting. They MUST be decoded for display:
 * the escaping is invisible for every ordinary name, so a missing decode ships silently and
 * only surfaces on the one name that needed it.
 */
const decodePath = (p: string) => {
  try {
    return decodeURIComponent(p);
  } catch {
    // A malformed sequence is not worth throwing over inside a results dialog; showing the
    // raw path is strictly more useful than showing nothing.
    return p;
  }
};

/**
 * The outcome of one Load action: one row per (file × work center) pair, because the server
 * pairs every package with every target and reports each independently — a corrupt package
 * fails only its own pair while its siblings still commit.
 *
 * Presentational: the caller owns the results state and clears it (onClose), so the dialog
 * is open iff results are present.
 */
export function LoadResultsDialog({ results, workCenterNames, onClose }: {
  results: LoadResult[] | null;
  workCenterNames: Record<string, string>;
  onClose: () => void;
}) {
  return (
    <Dialog open={results !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Load results</DialogTitle>
          <DialogDescription>{results ? summarize(results) : ''}</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-2 overflow-auto">
          {results?.map((r, i) => (
            <div key={i} className="rounded border px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${PILL[r.status]}`}>{LABEL[r.status]}</span>
                <span className="truncate font-medium">{r.filename}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {workCenterNames[r.workCenterId] ?? r.workCenterId}
                </span>
              </div>

              {r.status === 'failed' && <div className="mt-1 text-destructive">{r.message}</div>}

              {r.status === 'already_present' && r.message && (
                <div className="mt-1 text-xs text-muted-foreground">{r.message}</div>
              )}

              {(r.warnings?.length ?? 0) > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
                  {r.warnings!.map((w, wi) => <li key={wi}>{w}</li>)}
                </ul>
              )}

              {r.status !== 'failed' && r.kind === 'workflow' && (
                <div className="mt-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate">{r.name}</span>
                    <span className="text-muted-foreground">v{r.version} {r.state}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.nodeCount} nodes, {r.uiStepCount} UI steps, {r.envCount} environments
                    {typeof r.rolesCarried === 'number' ? `, ${r.rolesCarried} roles carried over` : ''}
                  </div>
                  {(r.nodesRemoved ?? 0) > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {r.nodesRemoved} removed ({r.grantsDropped ?? 0} role grants dropped)
                    </div>
                  )}
                  {(r.nodesRetained ?? 0) > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {r.nodesRetained} kept until running runtimes finish
                    </div>
                  )}
                  {r.rolesCreated && r.rolesCreated.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Roles created for e-signatures: {r.rolesCreated.join(', ')}
                    </div>
                  )}
                  {r.unmatchedPaths && r.unmatchedPaths.length > 0 && (
                    <div className="text-xs text-amber-700 dark:text-amber-400">
                      Roles not carried over (no matching node):
                      <ul className="ml-4 list-disc">
                        {r.unmatchedPaths.map((p) => <li key={p}>{decodePath(p)}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {r.status !== 'failed' && r.kind === 'environment' && (
                <ul className="mt-1 space-y-1">
                  {r.specs?.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${PILL[s.status]}`}>{LABEL[s.status]}</span>
                      <span className="truncate">{s.name}</span>
                      <span className="text-muted-foreground">v{s.version} {s.state}</span>
                    </li>
                  ))}
                  {r.updatedWorkflows && r.updatedWorkflows.length > 0 && (
                    <li className="text-xs text-muted-foreground">
                      Updated workflows: {r.updatedWorkflows.join(', ')}
                    </li>
                  )}
                </ul>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
