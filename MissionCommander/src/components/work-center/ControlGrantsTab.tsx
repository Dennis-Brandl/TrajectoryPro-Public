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
import { toast } from 'sonner';
import { controlGrants } from '@/lib/api/control-grants';
import type { ControlGrant, ControlGrantList, ControlGrantScope } from '@/lib/api/types';
import { apiErrorMessage } from '@/lib/api/client';
import { usePrincipalStore } from '@/stores/principalStore';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WorkCenterSelect } from './WorkCenterSelect';

const SCOPE_TEXT: Record<ControlGrantScope, string> = { own: 'Only runtimes it created', any: 'Any runtime' };

/** Spec 2026-10-15 §2.2 (R7): which other work centers' runtimes this one may create and command
 *  through the Distributed Workflow actions, and which work centers may do so here. */
export function ControlGrantsTab({ workCenterId }: { workCenterId: string }) {
  const isAdmin = usePrincipalStore((s) => s.principal?.isAdministrator ?? false);
  const [data, setData] = useState<ControlGrantList>({ outgoing: [], incoming: [] });
  const [target, setTarget] = useState<string | null>(null);
  const [scope, setScope] = useState<ControlGrantScope>('own');
  const [busy, setBusy] = useState(false);

  // Only the newest refresh may land: a grant/remove refresh can finish after a later one, or
  // after the tab moved to another work center, and must not overwrite fresher data.
  const reqToken = useRef(0);
  const refresh = useCallback(() => {
    const token = ++reqToken.current;
    controlGrants.list(workCenterId)
      .then((d) => { if (token === reqToken.current) setData(d); })
      .catch((err) => { if (token === reqToken.current) toast.error(apiErrorMessage(err, 'Loading control grants failed')); });
  }, [workCenterId]);
  useEffect(() => { refresh(); return () => { reqToken.current++; }; }, [refresh]);

  const grant = async () => {
    if (!target) return;
    setBusy(true);
    try { await controlGrants.set(workCenterId, target, scope); setTarget(null); refresh(); }
    catch (err) { toast.error(apiErrorMessage(err, 'Saving control grant failed')); }
    finally { setBusy(false); }
  };
  const remove = async (g: ControlGrant) => {
    try { await controlGrants.remove(workCenterId, g.targetWorkCenterId); refresh(); }
    catch (err) { toast.error(apiErrorMessage(err, 'Removing control grant failed')); }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">This work center may control</h3>
        <p className="text-sm text-muted-foreground">
          Runtime workflows here may create, start and command runtime workflows in these work centers.
          Its own work center never needs a grant.
        </p>
        {data.outgoing.length === 0
          ? <p className="text-sm text-muted-foreground">No grants.</p>
          : (
            <ul className="divide-y rounded-md border">
              {data.outgoing.map((g) => (
                <li key={g.targetWorkCenterId} className="flex items-center justify-between gap-4 px-3 py-2">
                  <span>{g.targetWorkCenterName}</span>
                  <span className="text-sm text-muted-foreground">{SCOPE_TEXT[g.scope]}</span>
                  {isAdmin && (
                    <Button type="button" variant="outline" size="sm" onClick={() => remove(g)} aria-label={`Remove grant for ${g.targetWorkCenterName}`}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56">
              <WorkCenterSelect id="grant-target" label="Work center" value={target} onChange={setTarget} excludeId={workCenterId} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="grant-scope">Commands reach</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as ControlGrantScope)}>
                <SelectTrigger id="grant-scope" className="w-56" aria-label="Commands reach"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="own">{SCOPE_TEXT.own}</SelectItem>
                  <SelectItem value="any">{SCOPE_TEXT.any}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" onClick={grant} disabled={!target || busy}>Grant</Button>
          </div>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Controlled by</h3>
        {data.incoming.length === 0
          ? <p className="text-sm text-muted-foreground">No other work center controls runtimes here.</p>
          : (
            <ul className="divide-y rounded-md border">
              {data.incoming.map((g) => (
                <li key={g.sourceWorkCenterId} className="flex items-center justify-between gap-4 px-3 py-2">
                  <span>{g.sourceWorkCenterName}</span>
                  <span className="text-sm text-muted-foreground">{SCOPE_TEXT[g.scope]}</span>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
