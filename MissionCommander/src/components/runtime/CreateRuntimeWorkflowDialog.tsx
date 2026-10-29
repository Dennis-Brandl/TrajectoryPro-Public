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
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { apiErrorMessage } from '@/lib/api/client';
import { runtimeStatusLabel } from '@/lib/runtime-status';
import type { RuntimeParameterSpec, RuntimeWorkflowSummary } from '@/lib/api/types';

type Props = {
  open: boolean; onOpenChange: (o: boolean) => void;
  workflowId: string; workflowName: string; workflowVersion: string; workflowState: string;
  onCreated?: (rw: RuntimeWorkflowSummary) => void;
};

// Starting-parameter entry for a new runtime workflow (spec §4/§7). The parameter model is
// untyped strings (default_value: string), so every field here is plain text regardless of
// the spec's "typed controls" language — a plan-level refinement, not a shortcut.
export function CreateRuntimeWorkflowDialog({
  open, onOpenChange, workflowId, workflowName, workflowVersion, workflowState, onCreated,
}: Props) {
  const [specs, setSpecs] = useState<RuntimeParameterSpec[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    if (!open) return;
    const id = ++reqId.current;
    setSpecs(null); setValues({}); setDirty(false);
    runtimeWorkflows.parameters(workflowId).then(
      (r) => {
        if (reqId.current !== id) return;   // stale response guard
        setSpecs(r.parameters);
        // Literal defaults prefill as entered values; property defaults resolve at start.
        setValues(Object.fromEntries(
          r.parameters.filter((p) => p.valueType === 'literal').map((p) => [p.id, p.defaultValue]),
        ));
      },
      (err) => { if (reqId.current === id) toast.error(apiErrorMessage(err, 'Failed to load parameters')); },
    );
  }, [open, workflowId]);

  const close = (o: boolean) => {
    if (!o && dirty && !window.confirm('Discard entered parameter values?')) return;
    onOpenChange(o);
  };

  // U6 (spec 2026-08-27): the old single "Create" made a pending instance that then "went to
  // wait" — confusing. Two explicit verbs; Create-and-Start is one server-side transaction.
  const handleCreate = async (start: boolean) => {
    setSaving(true);
    try {
      // Send entered values only: property-param fields left empty are omitted so the
      // engine resolves their defaults at start (spec §4.2 as refined by the plan).
      const params = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
      const rw = await runtimeWorkflows.create(workflowId, params, { start });
      toast.success(`${rw.runtimeLabel} created — ${runtimeStatusLabel(rw.status)}`);
      onCreated?.(rw);
      onOpenChange(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Create failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Create Runtime Workflow</DialogTitle>
          <DialogDescription>
            {workflowName} v{workflowVersion} ({workflowState})
          </DialogDescription>
        </DialogHeader>
        {specs === null ? (
          <p className="text-sm text-muted-foreground">Loading parameters…</p>
        ) : specs.length === 0 ? (
          <p className="text-sm text-muted-foreground">This workflow declares no starting parameters.</p>
        ) : (
          <div className="space-y-3">
            {specs.map((p) => (
              <div key={p.id} className="space-y-1">
                <Label htmlFor={`rwp-${p.id}`}>{p.id}</Label>
                {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                <Input
                  id={`rwp-${p.id}`}
                  value={values[p.id] ?? ''}
                  placeholder={p.valueType === 'property' ? `Resolved at start: ${p.defaultValue}` : undefined}
                  onChange={(e) => { setValues((v) => ({ ...v, [p.id]: e.target.value })); setDirty(true); }}
                />
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button type="button" variant="outline" onClick={() => void handleCreate(false)} disabled={saving || specs === null}>Create and Wait</Button>
          <Button type="button" onClick={() => void handleCreate(true)} disabled={saving || specs === null}>Create and Start</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
