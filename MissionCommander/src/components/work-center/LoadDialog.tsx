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
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { load } from '@/lib/api/load';
import { workCenters } from '@/lib/api/work-centers';
import { apiErrorMessage } from '@/lib/api/client';
import type { LoadResult, WcNode } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

// One action carries several packages of either kind into several work centers. The server
// routes each file by extension and pairs it with every target, so the steward never picks
// an artifact type — that is what made the two old /import routes awkward.
export function LoadDialog({ open, onOpenChange, workCenterId, workCenterName, onLoaded }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workCenterId: string;
  workCenterName: string;
  // The name map travels with the results because this dialog already fetched the work
  // center list to build its fan-out picker. Without it the results dialog can only render
  // raw uuids for every extra target.
  onLoaded: (results: LoadResult[], workCenterNames: Record<string, string>) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [extras, setExtras] = useState<string[]>([]);
  const [targets, setTargets] = useState<WcNode[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    workCenters.list()
      // The current work center is implicit in the URL; offering it as an extra target
      // invites a tick the server would only de-duplicate away.
      .then((r) => setTargets(r.nodes.filter((n) => n.id !== workCenterId)))
      // Losing the fan-out list must not block the primary action — loading into THIS work
      // center still works, which is the common case.
      .catch(() => setTargets([]));
  }, [open, workCenterId]);

  const submit = async () => {
    setBusy(true);
    try {
      const { results } = await load.load(workCenterId, files, extras);
      const names: Record<string, string> = { [workCenterId]: workCenterName };
      for (const t of targets) names[t.id] = t.name;
      onLoaded(results, names);
      onOpenChange(false);
      setFiles([]);
      setExtras([]);
    } catch (err) {
      // Stay open on failure: the steward's file selection is expensive to redo.
      toast.error(apiErrorMessage(err, 'Load failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Load packages into {workCenterName}</DialogTitle>
          <DialogDescription>
            Loading creates an independent entry. A package already present at the same
            version and state is reported as already present, not loaded again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label htmlFor="load-files">Packages</Label>
          <Input id="load-files" type="file" multiple accept=".WFmasterX,.WFenvirX"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        </div>

        {targets.length > 0 && (
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Also load into</legend>
            {targets.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" aria-label={t.name} checked={extras.includes(t.id)}
                  onChange={(e) => setExtras((prev) =>
                    e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id))} />
                {t.name}
              </label>
            ))}
          </fieldset>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={busy || files.length === 0}>Load</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
