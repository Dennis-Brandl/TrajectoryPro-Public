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
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';
import { authClient } from '@/lib/auth/auth-client';
import { runBoot } from '@/lib/auth/boot';
import { usePrincipal } from '@/stores/principalStore';
import { Button } from '@/components/ui/button';

// Persistent banner shown whenever the live session is an impersonation session
// (better-auth sets session.impersonatedBy). Stop restores the admin session and
// re-boots the principal, then navigates home to re-run the auth guard cleanly.
export function ImpersonationBanner() {
  const navigate = useNavigate();
  const principal = usePrincipal();
  const { data } = authClient.useSession();
  // Declared before the early return below so hook order stays stable regardless
  // of `impersonating` (Rules of Hooks).
  const [busy, setBusy] = useState(false);
  // adminClient() augments the inferred session type with impersonatedBy; if typecheck
  // reports it as missing on this better-auth build, narrow via a local type instead of
  // `any`: `const session = data?.session as { impersonatedBy?: string | null } | undefined;`
  const impersonating = !!data?.session?.impersonatedBy;
  if (!impersonating) return null;

  const stop = async () => {
    setBusy(true);
    try {
      const { error } = await authClient.admin.stopImpersonating();
      if (error) { toast.error(error.message || 'Failed to stop impersonating'); return; }
      const boot = await runBoot();
      if (!boot.ok) toast.error('Session restored, but it could not be reloaded — refresh the page');
      navigate({ to: '/' });
    } finally { setBusy(false); }
  };

  return (
    <div role="status" aria-live="polite" className="flex items-center justify-between gap-3 bg-amber-500/15 px-4 py-1.5 text-sm text-amber-900 dark:text-amber-200">
      {/* No nested <strong>: the default getByText matcher only concatenates a node's
          direct Text-node children, so wrapping the name in its own element would
          split "Impersonating {name}" across two nodes and break text matching. */}
      <span className="font-medium">Impersonating {principal?.displayName}</span>
      <Button type="button" variant="outline" size="sm" onClick={stop} disabled={busy}>Stop impersonating</Button>
    </div>
  );
}
