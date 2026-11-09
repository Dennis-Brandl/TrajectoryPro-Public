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
import { usePrincipalStore } from '@/stores/principalStore';
import { apiClients, API_CLIENT_SCOPES, type ApiClientScope, type ApiClientView } from '@/lib/api/api-clients';
import { workCenters } from '@/lib/api/work-centers';
import { apiErrorMessage } from '@/lib/api/client';
import type { WcNode } from '@/lib/api/types';
import { copyText } from '@/lib/copy-text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUS_LABEL = { active: 'Active', revoked: 'Revoked', expired: 'Expired' } as const;
const fmt = (iso: string | null, none: string) => (iso ? new Date(iso).toLocaleString() : none);

// API clients (spec 2026-11-08 §8.1): the credentials a higher-level scheduling system uses to
// call Trajectory Pro. Administrator only. A token is shown once, when it is created.
export function ApiClientsPanel() {
  const isAdmin = usePrincipalStore((s) => s.principal?.isAdministrator ?? false);
  const [clients, setClients] = useState<ApiClientView[]>([]);
  const [nodes, setNodes] = useState<WcNode[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wcError, setWcError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiClientView | null>(null);

  const reload = useCallback(async () => {
    try {
      setClients(await apiClients.list());
      setLoadError(null);
    } catch (err) {
      setLoadError(apiErrorMessage(err, 'Failed to load API clients'));
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void reload();
    workCenters.list()
      .then((r) => { setNodes(r.nodes); setWcError(null); })
      .catch((err) => { setNodes([]); setWcError(apiErrorMessage(err, 'Failed to load work centers')); });
  }, [isAdmin, reload]);

  if (!isAdmin) return null;

  const wcNames = new Map(nodes.map((n) => [n.id, n.name]));
  const closeCreate = () => { setCreating(false); setToken(null); };

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">API clients</h2>
        <Button type="button" size="sm" onClick={() => setCreating(true)}>New client</Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        A scheduling system signs in with an API token to read and send schedules for the work centers you choose. Use HTTPS in production.
      </p>
      {loadError && <p role="alert" className="mt-3 text-sm text-destructive">{loadError}</p>}
      {wcError && <p role="alert" className="mt-3 text-sm text-destructive">{wcError}. Work center names and the New client list may be incomplete.</p>}
      <Table className="mt-3">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Token</TableHead>
            <TableHead>Scopes</TableHead>
            <TableHead>Work centers</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((c) => (
            <TableRow key={c.id}>
              <TableCell>{c.name}</TableCell>
              <TableCell className="font-mono text-xs">{c.tokenPrefix}</TableCell>
              <TableCell>{c.scopes.join(', ')}</TableCell>
              <TableCell>{c.workCenterIds.map((id) => wcNames.get(id) ?? 'Unknown').join(', ')}</TableCell>
              <TableCell>{fmt(c.lastUsedAt, 'Never')}</TableCell>
              <TableCell>{fmt(c.expiresAt, 'Never')}</TableCell>
              <TableCell>{STATUS_LABEL[c.status]}</TableCell>
              <TableCell>
                {c.status === 'active' && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setRevoking(c)}>Revoke</Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {clients.length === 0 && !loadError && (
            <TableRow><TableCell colSpan={8} className="text-muted-foreground">No API clients yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      {creating && (
        <NewClientDialog
          nodes={nodes}
          token={token}
          onClose={closeCreate}
          onCreated={async (t) => { setToken(t); await reload(); }}
        />
      )}

      <Dialog open={revoking !== null} onOpenChange={(open) => { if (!open) setRevoking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke API client?</DialogTitle>
            <DialogDescription>
              “{revoking?.name}” stops working immediately. This cannot be undone. To give the system access again, create a new client.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRevoking(null)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={async () => {
              if (!revoking) return;
              try {
                await apiClients.revoke(revoking.id);
                toast.success('API client revoked');
                setRevoking(null);
                await reload();
              } catch (err) {
                toast.error(apiErrorMessage(err, 'Failed to revoke API client'));
              }
            }}>Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewClientDialog({ nodes, token, onClose, onCreated }: {
  nodes: WcNode[];
  token: string | null;
  onClose: () => void;
  onCreated: (token: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiClientScope[]>([]);
  const [wcIds, setWcIds] = useState<string[]>([]);
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const ready = name.trim() !== '' && scopes.length > 0 && wcIds.length > 0;

  const create = async () => {
    setBusy(true);
    try {
      const expiresAt = expires ? new Date(expires) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) { toast.error('Expiry is not a valid date'); return; }
      const result = await apiClients.create({
        name: name.trim(), scopes, workCenterIds: wcIds, ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
      });
      await onCreated(result.token);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to create API client'));
    } finally {
      setBusy(false);
    }
  };

  if (token !== null) {
    return (
      // Done is the only way out: Escape or a click outside would destroy the one copy of the token.
      <Dialog open onOpenChange={() => { /* closed by Done only */ }}>
        <DialogContent
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>API token</DialogTitle>
            <DialogDescription>Copy this token now. It won't be shown again.</DialogDescription>
          </DialogHeader>
          <Input readOnly aria-label="API token" value={token} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={async () => {
              if (await copyText(token)) toast.success('Token copied');
              else toast.error('Could not copy. Select the token and copy it by hand.');
            }}>Copy</Button>
            <Button type="button" onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New API client</DialogTitle>
          <DialogDescription>The token is shown once, after you create the client.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="space-y-1">
            <label htmlFor="api-client-name" className="text-sm font-medium">Name</label>
            <Input id="api-client-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </div>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Scopes</legend>
            {API_CLIENT_SCOPES.map((s) => (
              <label key={s} className="flex gap-2 items-center text-sm">
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => setScopes(toggle(scopes, s))} />
                <span>{s}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Work centers</legend>
            {nodes.map((n) => (
              <label key={n.id} className="flex gap-2 items-center text-sm" style={{ paddingLeft: n.depth * 12 }}>
                <input type="checkbox" checked={wcIds.includes(n.id)} onChange={() => setWcIds(toggle(wcIds, n.id))} />
                <span>{n.name}</span>
              </label>
            ))}
          </fieldset>
          <div className="space-y-1">
            <label htmlFor="api-client-expires" className="text-sm font-medium">Expires (optional)</label>
            <Input id="api-client-expires" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={create} disabled={!ready || busy}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
