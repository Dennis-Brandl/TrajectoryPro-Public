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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { allowedRoles } from '@/lib/api/allowed-roles';
import { roles as rolesApi } from '@/lib/api/roles';
import { apiErrorMessage } from '@/lib/api/client';
import type { AllowedRolesView, Role } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

// Per-node allowed-role editor (spec §6.4). Opened from a loaded workflow's "Roles…" action.
//
// This is a DRAFT editor: checkboxes mutate local state only, and Save commits the whole
// desired set in one atomic PUT. It used to fire a mutation per toggle, which left Cancel
// with nothing to undo and made a stray click on the scrim a silent commit.
//
// M6: keyed on the WORKFLOW ENTRY alone. Two work centers holding the same oid are separate
// entries with separate assignments, and the workflow id already determines its work center.
type Draft = Map<string, Set<string>>;

function toDraft(view: AllowedRolesView): Draft {
  return new Map(view.nodes.map((n) => [n.nodeId, new Set(n.roleIds)]));
}

function sameDraft(a: Draft, b: Draft): boolean {
  if (a.size !== b.size) return false;
  for (const [nodeId, roles] of a) {
    const other = b.get(nodeId);
    if (!other || other.size !== roles.size) return false;
    for (const r of roles) if (!other.has(r)) return false;
  }
  return true;
}

export function AllowedRolesDialog({ open, onOpenChange, workflowId, workflowName, onClosed }:
  { open: boolean; onOpenChange: (o: boolean) => void; workflowId: string; workflowName: string; onClosed: () => void }) {
  const [viewData, setViewData] = useState<AllowedRolesView | null>(null);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [draft, setDraft] = useState<Draft>(new Map());
  const [pristine, setPristine] = useState<Draft>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const reqId = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setLoading(true);
    setFailed(false); // reset on every load (incl. reopen) — a prior failure must not latch
    try {
      const [view, roleList] = await Promise.all([allowedRoles.get(workflowId), rolesApi.list()]);
      if (my !== reqId.current) return;
      setViewData(view);
      setDraft(toDraft(view));
      setPristine(toDraft(view));
      setAllRoles([...roleList.roles].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      if (my !== reqId.current) return;
      toast.error(apiErrorMessage(err, 'Failed to load allowed roles'));
      setFailed(true);
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => { if (open) void load(); return () => { reqId.current++; }; }, [open, load]);

  const dirty = useMemo(() => !sameDraft(draft, pristine), [draft, pristine]);

  const toggle = (nodeId: string, roleId: string) => {
    setDraft((prev) => {
      const next = new Map(prev);
      const roles = new Set(next.get(nodeId) ?? []);
      if (roles.has(roleId)) roles.delete(roleId); else roles.add(roleId);
      next.set(nodeId, roles);
      return next;
    });
  };

  const close = () => { onOpenChange(false); onClosed(); };

  const save = async () => {
    if (!viewData) return;
    setSaving(true);
    try {
      // Send every node, including the ones left empty — this is the complete desired
      // state, so an omitted node would read as "no change" rather than "cleared".
      await allowedRoles.setRoles(workflowId, viewData.nodes.map((n) => ({
        nodeId: n.nodeId, roleIds: [...(draft.get(n.nodeId) ?? [])],
      })));
      toast.success('Roles saved');
      close();
    } catch (err) {
      // Nothing was written (the DAO validates before its first write), so the draft is
      // still a valid thing to retry or cancel — keep it and stay open.
      toast.error(apiErrorMessage(err, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else onOpenChange(o); }}>
      {/*
        Clicking the scrim used to dismiss — and because every toggle was committed on the
        spot, that read as "cancel" while actually having saved. Edits are drafts now, but a
        stray click still discarding them is bad, so the scrim no longer closes the dialog.
        Esc is left alone: in a draft editor, discard IS what Esc should mean.
      */}
      <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Allowed roles — {workflowName}</DialogTitle>
          <DialogDescription>Choose which roles may act on each interactive step.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">Failed to load allowed roles</p>
        ) : !viewData ? null : viewData.nodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">This workflow has no interactive steps.</p>
        ) : (
          <div className="max-h-96 space-y-4 overflow-auto">
            {/* Depth indentation mirrors the workflow's child-workflow tree (spec 2026-08-14
                D9); ancestor nodes with no UI steps of their own are editable because their
                grants are inherited by nearest-ancestor resolution at runtime. */}
            {viewData.nodes.map((node) => (
              <div key={node.nodeId} className="space-y-1" style={{ paddingLeft: node.depth * 16 }}>
                <div className="text-sm font-medium">
                  {node.nodeName}
                  {!node.ownsUiSteps && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">(applies to nested steps)</span>
                  )}
                </div>
                <div className="space-y-1 pl-2">
                  {allRoles.map((role) => (
                    <label key={role.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" aria-label={`${node.nodeName} — ${role.name}`}
                        checked={draft.get(node.nodeId)?.has(role.id) ?? false} disabled={saving}
                        onChange={() => toggle(node.nodeId, role.id)} />
                      <span>{role.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={save} disabled={!dirty || saving || loading || !viewData}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
