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
import { createFileRoute, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import { AppHeader } from '@mission/ui';
import { authClient, signOut } from '@/lib/auth/auth-client';
import { getSetupStatus } from '@/lib/auth/setupClient';
import { runBoot } from '@/lib/auth/boot';
import { usePrincipalStore } from '@/stores/principalStore';
import { useTheme } from '@/hooks/useTheme';
import { useSignedInUserCheck } from '@/hooks/useSignedInUserCheck';
import { useSelectionStore } from '@/stores/selectionStore';
import { ImpersonationBanner } from '@/components/shell/ImpersonationBanner';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) throw redirect({ to: '/login' });
    let status: { setupComplete: boolean } | null = null;
    try { status = await getSetupStatus(); } catch { status = null; }
    if (status && !status.setupComplete) throw redirect({ to: '/setup' });
    const boot = await runBoot();
    if (!boot.ok) throw redirect({ to: '/login' });
    return { user: session.data.user };
  },
  component: AuthenticatedLayout,
});

// Exported for its test, matching how login.tsx exports LoginPage alongside its Route.
export function AuthenticatedLayout() {
  const navigate = useNavigate();
  const principal = usePrincipalStore((s) => s.principal);
  const { theme, toggleTheme } = useTheme();
  useSignedInUserCheck(principal?.id);
  const logout = async () => { await signOut(); usePrincipalStore.getState().clearPrincipal(); navigate({ to: '/login' }); };
  const activeHierarchy = useSelectionStore((s) => s.activeHierarchy);
  const setHierarchy = useSelectionStore((s) => s.setHierarchy);
  return (
    <div className="flex h-screen flex-col">
      <AppHeader
        appName="Mission Commander"
        buildVersion={__APP_VERSION__}
        tagline="Runs workflows in work centers"
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setHierarchy('settings')}
        settingsActive={activeHierarchy === 'settings'}
        userName={principal?.displayName}
        onSignOut={logout}
        tools={(
          <a href="/xo/" target="_blank" rel="noopener" className="rounded px-2 py-1 text-xs font-medium hover:underline">
            Open Mission XO
          </a>
        )}
      />
      <ImpersonationBanner />
      <div className="min-h-0 flex-1"><Outlet /></div>
    </div>
  );
}
