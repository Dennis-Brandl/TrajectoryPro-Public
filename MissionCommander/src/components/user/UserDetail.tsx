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
import { useNavigate } from '@tanstack/react-router';
import { useSelectionStore } from '@/stores/selectionStore';
import { useHasRight, usePrincipal } from '@/stores/principalStore';
import { useResourceView } from '@/lib/hooks/useResourceView';
import { users } from '@/lib/api/users';
import { apiErrorMessage } from '@/lib/api/client';
import { ACCESS_LEVELS, type AccessLevel } from '@/lib/access-levels';
import type { UserView, UserWorkCenterMembership, WorkCenterView } from '@/lib/api/types';
import { authClient } from '@/lib/auth/auth-client';
import { runBoot } from '@/lib/auth/boot';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshErrorBanner } from '@/components/shell/RefreshErrorBanner';
import { RequiresTooltip } from '@/components/shared/RequiresTooltip';
import { WorkCenterUserRolesDialog } from '@/components/work-center/WorkCenterUserRolesDialog';
import { SetPasswordDialog } from './SetPasswordDialog';
import { SessionsTab } from './SessionsTab';
import { refreshUserTree } from './UserTree';

// Mirrors mission-control-db's LOGIN_NAME_RE (spec 2026-09-06 D6). The server re-validates;
// this only gives the form an inline hint before the round trip.
export const LOGIN_NAME_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
export const LOGIN_NAME_HINT = 'Lowercase letters, digits, dot, underscore, hyphen; 2–64 characters, starting with a letter or digit.';
// Mirrors mission-control-db's isValidEmail; the server re-validates and lowercases.
const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function UserDetail() {
  const selectedUserId = useSelectionStore((s) => s.selectedUserId);
  const fetchUser = useCallback((id: string) => users.get(id), []);
  const { view, loading, error, setView, refresh } = useResourceView<UserView>(selectedUserId, fetchUser, 'Failed to load user');
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  // The membership row whose roles are being edited (one work center at a time).
  const [rolesFor, setRolesFor] = useState<UserWorkCenterMembership | null>(null);
  const [impersonating, setImpersonating] = useState(false);
  // Bumped whenever a server action revokes the target's sessions (set-password,
  // disable) so an open Sessions tab remounts SessionsTab (key) and refetches instead
  // of continuing to show now-dead rows.
  const [sessionsEpoch, setSessionsEpoch] = useState(0);
  const navigate = useNavigate();
  const principal = usePrincipal();

  const canEditName = useHasRight('user:edit');
  const canManageAccess = useHasRight('access:edit');
  // Same right that gates the work center's Users tab (spec 2026-09-06 D4): the per-row
  // "Add Role" below hits the same PUT /work-centers/:id/users/:userId/roles route.
  const canLink = useHasRight('work_center:link');

  if (loading && !view) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  // Only take the full-panel slot when there's no stale view to fall back to; a
  // failed same-id refresh() keeps its stale view mounted (useResourceView), so that
  // case falls through to the banner rendered below instead.
  if (error && !view) return <div className="p-4 text-sm text-destructive">Failed to load user</div>;
  if (!view) return null;

  const isSelf = principal?.id === view.user.id;
  // The roles route answers with the WORK CENTER's refreshed view (house rule: a mutation
  // returns the view it belongs to), so lift this user's roles for that work center out of
  // it rather than refetching the user; refetch only if the row is unexpectedly absent.
  const applyRoles = (workCenterId: string, wcView: WorkCenterView) => {
    const mine = wcView.users.find((u) => u.id === view.user.id)?.roles;
    if (!mine) { refresh(); return; }
    setView({ ...view, workCenters: view.workCenters.map((m) => (m.workCenter.id === workCenterId ? { ...m, roles: mine } : m)) });
  };
  const showImpersonate = canManageAccess && !isSelf && view.user.status !== 'disabled' && view.user.accessLevel !== 'administrator';
  const impersonate = async () => {
    if (impersonating) return; // in-flight guard: ignore a second click
    setImpersonating(true);
    try {
      const { error } = await authClient.admin.impersonateUser({ userId: view.user.id });
      if (error) { toast.error(error.message || 'Impersonation failed'); return; }
      const boot = await runBoot();   // refresh principalStore to the impersonated user
      if (!boot.ok) toast.error('Impersonation started, but the session could not be loaded — reloading');
      navigate({ to: '/' });          // re-run _authenticated beforeLoad → clean slate
    } finally {
      setImpersonating(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {error && <RefreshErrorBanner />}
      <div className="space-y-1">
        <div className="text-sm text-muted-foreground">Users ›</div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">{view.user.displayName}</h1>
            {view.user.status === 'disabled' && <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">disabled</span>}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <RequiresTooltip reason={canEditName ? undefined : 'Requires user:edit'}>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}
                disabled={!canEditName} title={canEditName ? undefined : 'Requires user:edit'}>Edit</Button>
            </RequiresTooltip>
            {canManageAccess ? (
              <Select value={view.user.accessLevel} onValueChange={async (level: AccessLevel) => {
                try { setView(await users.setAccess(view.user.id, level)); refreshUserTree(); toast.success('Access level updated'); }
                catch (err) { toast.error(apiErrorMessage(err, 'Access change failed')); }
              }}>
                <RequiresTooltip reason={isSelf ? 'You cannot change your own access level' : undefined}>
                  <SelectTrigger className="h-8 w-36" aria-label="Access level" disabled={isSelf}
                    title={isSelf ? 'You cannot change your own access level' : undefined}><SelectValue /></SelectTrigger>
                </RequiresTooltip>
                <SelectContent>{ACCESS_LEVELS.map((l) => (<SelectItem key={l} value={l}>{l}</SelectItem>))}</SelectContent>
              </Select>
            ) : (
              <span className="rounded bg-muted px-2 py-0.5 text-xs" aria-label="Access level">{view.user.accessLevel}</span>
            )}
            <RequiresTooltip reason={canManageAccess ? undefined : 'Requires access:edit'}>
              <Button type="button" variant="outline" size="sm" onClick={() => setPasswordOpen(true)}
                disabled={!canManageAccess} title={canManageAccess ? undefined : 'Requires access:edit'}>Set password</Button>
            </RequiresTooltip>
            <RequiresTooltip reason={!canManageAccess ? 'Requires access:edit' : isSelf ? 'You cannot disable your own account' : undefined}>
              <Button type="button" variant="outline" size="sm"
                onClick={async () => {
                  const next = view.user.status === 'disabled' ? 'active' : 'disabled';
                  try {
                    setView(await users.setStatus(view.user.id, next));
                    refreshUserTree();
                    setSessionsEpoch((e) => e + 1);
                    toast.success(next === 'disabled' ? 'User disabled' : 'User enabled');
                  }
                  catch (err) { toast.error(apiErrorMessage(err, 'Status change failed')); }
                }}
                disabled={!canManageAccess || isSelf}
                title={!canManageAccess ? 'Requires access:edit' : isSelf ? 'You cannot disable your own account' : undefined}>
                {view.user.status === 'disabled' ? 'Enable' : 'Disable'}
              </Button>
            </RequiresTooltip>
            {showImpersonate && (
              <Button type="button" variant="outline" size="sm" onClick={impersonate} disabled={impersonating}>Impersonate</Button>
            )}
          </div>
        </div>
        {/* Spec 2026-09-06 D6: the login name is what an operator types on an e-signature. */}
        <div className="text-sm text-muted-foreground">{view.user.email} · {view.user.loginName}</div>
      </div>

      <EditUserDialog open={editOpen} onOpenChange={setEditOpen}
        current={{ displayName: view.user.displayName, loginName: view.user.loginName, email: view.user.email }}
        canEditEmail={canManageAccess}
        onSubmit={async (patch) => {
          try { setView(await users.update(view.user.id, patch)); refreshUserTree(); toast.success('User updated'); setEditOpen(false); }
          catch (err) { toast.error(apiErrorMessage(err, 'Update failed')); }
        }} />

      <SetPasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} userId={view.user.id}
        onDone={() => setSessionsEpoch((e) => e + 1)} />

      {rolesFor && (
        <WorkCenterUserRolesDialog
          open onOpenChange={(o) => { if (!o) setRolesFor(null); }}
          workCenterId={rolesFor.workCenter.id}
          workCenterName={rolesFor.workCenter.name}
          member={{ ...view.user, missionSystemCommander: rolesFor.missionSystemCommander, roles: rolesFor.roles }}
          onSaved={(wcView) => { applyRoles(rolesFor.workCenter.id, wcView); setRolesFor(null); }}
        />
      )}

      {/* Spec 2026-09-06 D3: roles are per work center, so the former Roles tab (global picker)
          is gone — memberships list the roles held in each work center. 2026-09-09 (user
          feedback): assigning roles is a task centred on the USER and the work centers they
          belong to, so each row also opens the per-work-center roles dialog. */}
      <Tabs defaultValue="workCenters">
        <TabsList>
          <TabsTrigger value="workCenters">Work Centers</TabsTrigger>
          {canManageAccess && <TabsTrigger value="sessions">Sessions</TabsTrigger>}
        </TabsList>
        <TabsContent value="workCenters">
          {view.workCenters.length === 0 ? <p className="text-sm text-muted-foreground">No work centers</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Mission System Commander</TableHead><TableHead>Roles</TableHead></TableRow></TableHeader>
              <TableBody>
                {view.workCenters.map((m) => (
                  <TableRow key={m.workCenter.id}>
                    <TableCell>{m.workCenter.name}</TableCell>
                    <TableCell>{m.missionSystemCommander ? 'Yes' : '—'}</TableCell>
                    <TableCell>
                      <span>{m.roles.length ? m.roles.map((r) => r.name).join(', ') : '—'}</span>
                      <RequiresTooltip reason={canLink ? undefined : 'Requires work_center:link'}>
                        <Button type="button" variant="outline" size="sm" className="ml-2" aria-label={`Add Role in ${m.workCenter.name}`}
                          onClick={() => setRolesFor(m)} disabled={!canLink}
                          title={canLink ? undefined : 'Requires work_center:link'}>Add Role</Button>
                      </RequiresTooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Membership and Mission System Commander are edited from the work center.</p>
        </TabsContent>
        {canManageAccess && (
          <TabsContent value="sessions"><SessionsTab key={sessionsEpoch} userId={view.user.id} /></TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function EditUserDialog({ open, onOpenChange, current, canEditEmail, onSubmit }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  current: { displayName: string; loginName: string; email: string };
  // The email is the sign-in identifier: changing it needs access:edit, like Set password.
  canEditEmail: boolean;
  onSubmit: (patch: { displayName: string; loginName: string; email?: string }) => void;
}) {
  const [name, setName] = useState(current.displayName);
  const [login, setLogin] = useState(current.loginName);
  const [email, setEmail] = useState(current.email);
  // Depend on the strings, not the `current` object: the parent builds a fresh object every
  // render, and an object dependency would reset the draft on every keystroke.
  useEffect(() => {
    if (open) { setName(current.displayName); setLogin(current.loginName); setEmail(current.email); }
  }, [open, current.displayName, current.loginName, current.email]);
  const normalisedLogin = login.trim().toLowerCase();
  const loginOk = LOGIN_NAME_RE.test(normalisedLogin);
  const showLoginHint = login !== '' && !loginOk;
  const normalisedEmail = email.trim().toLowerCase();
  const emailOk = EMAIL_RE.test(normalisedEmail);
  // Only an actual change is sent, so a steward's rename never trips the access:edit check.
  const emailChanged = normalisedEmail !== current.email;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit user</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="user-rename">Display name</Label>
            <Input id="user-rename" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="user-login-edit">Login name</Label>
            <Input id="user-login-edit" value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <p className={showLoginHint ? 'text-sm text-destructive' : 'text-xs text-muted-foreground'}>{LOGIN_NAME_HINT}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="user-email-edit">Email</Label>
            <Input id="user-email-edit" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              disabled={!canEditEmail} title={canEditEmail ? undefined : 'Requires access:edit'}
              autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            {canEditEmail && email !== '' && !emailOk
              ? <p className="text-sm text-destructive">Enter a valid email</p>
              : <p className="text-xs text-muted-foreground">The user signs in with this email{canEditEmail ? '' : ' (changing it requires access:edit)'}.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button"
            onClick={() => onSubmit({ displayName: name.trim(), loginName: normalisedLogin, ...(emailChanged ? { email: normalisedEmail } : {}) })}
            disabled={name.trim() === '' || !loginOk || (emailChanged && !emailOk)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
