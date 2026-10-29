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
import { roles as rolesApi } from '@/lib/api/roles';
import { workCenters } from '@/lib/api/work-centers';
import { apiErrorMessage } from '@/lib/api/client';
import type { Role, WorkCenterMember, WorkCenterView } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

// Per-member role editor (spec 2026-09-06 D3), opened from the work center's Users tab and,
// since 2026-09-09, from the user's own Work Centers tab (one row per work center). Same
// draft-then-atomic-save shape as AllowedRolesDialog — checkboxes mutate local state, Save
// PUTs the complete desired set, Cancel/Esc discards, the scrim never commits.
function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function WorkCenterUserRolesDialog({ open, onOpenChange, workCenterId, workCenterName, member, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  workCenterId: string;
  /** Named in the description when the dialog is opened away from the work center itself
   *  (the Users screen's per-row "Add Role", 2026-09-09), where "this work center" is unclear. */
  workCenterName?: string;
  member: WorkCenterMember;
  onSaved: (view: WorkCenterView) => void;
}) {
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const pristine = useMemo(() => new Set(member.roles.map((r) => r.id)), [member]);
  const [draft, setDraft] = useState<Set<string>>(pristine);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setLoading(true);
    setFailed(false);
    try {
      const list = await rolesApi.list();
      if (my !== reqId.current) return;
      setAllRoles([...list.roles].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft(new Set(pristine));
    } catch (err) {
      if (my !== reqId.current) return;
      toast.error(apiErrorMessage(err, 'Failed to load roles'));
      setFailed(true);
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [pristine]);

  useEffect(() => { if (open) void load(); return () => { reqId.current++; }; }, [open, load]);

  const dirty = !sameSet(draft, pristine);

  const toggle = (roleId: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId); else next.add(roleId);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      // Sorted by role id so the request is deterministic for the same set.
      const view = await workCenters.setUserRoles(workCenterId, member.id, [...draft].sort());
      toast.success('Roles updated');
      onSaved(view);
      onOpenChange(false);
    } catch (err) {
      // Nothing was written (the DAO checks membership before its first write and the
      // insert is transactional), so the draft is still worth retrying or cancelling.
      toast.error(apiErrorMessage(err, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); else onOpenChange(o); }}>
      <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Roles — {member.displayName}</DialogTitle>
          <DialogDescription>
            Roles this member holds in {workCenterName ?? 'this work center'}. Roles are never global.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">Failed to load roles</p>
        ) : allRoles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No roles exist yet — create one in the Roles hierarchy.</p>
        ) : (
          <div className="max-h-96 space-y-1 overflow-auto">
            {allRoles.map((role) => (
              <label key={role.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" aria-label={role.name}
                  checked={draft.has(role.id)} disabled={saving}
                  onChange={() => toggle(role.id)} />
                <span>{role.name}</span>
                {role.description && <span className="text-xs text-muted-foreground">— {role.description}</span>}
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={save} disabled={!dirty || saving || loading || failed}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
