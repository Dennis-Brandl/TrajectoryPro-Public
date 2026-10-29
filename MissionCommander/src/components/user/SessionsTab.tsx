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
import { authClient } from '@/lib/auth/auth-client';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type SessionRow = { id: string; token: string; createdAt: Date | string; expiresAt: Date | string };

// Admin-only session management (spec §7.2). Rides the better-auth admin client
// (browser-side), which reaches /api/auth/admin/list-user-sessions + revoke-user-session
// — both in the LIVE (unblocked) endpoint set.
export function SessionsTab({ userId }: { userId: string }) {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const { data } = authClient.useSession();
  const currentToken = data?.session?.token;

  const reqId = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setLoading(true);
    const { data, error } = await authClient.admin.listUserSessions({ userId });
    if (my !== reqId.current) return; // superseded by a newer load()/unmount — drop it
    if (error) toast.error(error.message ?? 'Failed to load sessions');
    setFailed(!!error);
    setRows(((data?.sessions ?? []) as SessionRow[]));
    setLoading(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { reqId.current++; }, []); // invalidate a pending load on unmount

  const revokeOne = async (token: string) => {
    const { error } = await authClient.admin.revokeUserSession({ sessionToken: token });
    if (error) { toast.error(error.message ?? 'Revoke failed'); return; }
    toast.success('Session revoked');
    await load();
  };
  const revokeAll = async () => {
    const { error } = await authClient.admin.revokeUserSessions({ userId });
    if (error) { toast.error(error.message ?? 'Revoke failed'); return; }
    toast.success('All sessions revoked');
    await load();
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading sessions…</p>;
  if (failed) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">Failed to load sessions</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={revokeAll} disabled={rows.length === 0}>Revoke all</Button>
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No active sessions</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>Created</TableHead><TableHead>Expires</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  {new Date(s.createdAt).toLocaleString()}
                  {!!currentToken && s.token === currentToken && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">Current</span>}
                </TableCell>
                <TableCell>{new Date(s.expiresAt).toLocaleString()}</TableCell>
                <TableCell>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Revoke session ${s.id}`} onClick={() => revokeOne(s.token)}>Revoke</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
