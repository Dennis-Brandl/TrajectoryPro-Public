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
import { createFileRoute, Outlet, redirect, useRouter } from '@tanstack/react-router';
import { AppHeader } from '@mission/ui';
import { authClient, signOut } from '~/lib/auth-client';
import { useTheme } from '@/hooks/useTheme';
import { useMeStore } from '~/stores/meStore';
import { usePrincipalStore } from '@/stores/principalStore';
import { canUseXo } from '~/lib/access';
import { Button } from '@/components/ui/button';
import { useWorkCenterStore } from '~/stores/workCenterStore';
import { NotForYou } from '~/components/NotForYou';
import { SwitcherButton } from '~/components/shell/WorkCenterSwitcher';
import { useLayout } from '~/lib/layout';

export const Route = createFileRoute('/_xo')({
  beforeLoad: async () => {
    // Every tap is a navigation (selection lives in the URL), so once the user is known a tap
    // must never wait on, or fail with, the network: refresh in the background and ignore a
    // failure. A lost connection shows the Not-connected banner over the last data; a 401
    // still hard-navigates to sign-in through the API client's unauthorized handler.
    if (useMeStore.getState().me) {
      useMeStore.getState().refresh().catch(() => { /* offline: keep the last user */ });
      return;
    }
    const session = await authClient.getSession();
    if (!session.data) throw redirect({ to: '/login' });
    // A failed me() is NOT a sign-out (a 401 already hard-navigates): redirecting to /login
    // here would bounce straight back, since the login page sees the live session.
    try {
      await useMeStore.getState().refresh();
    } catch (e) {
      console.error('Mission XO: could not load the signed-in user', e);
      throw e;
    }
  },
  component: XoLayout,
  errorComponent: XoUnreachable,
});

async function leave() {
  try { await signOut(); } finally {
    usePrincipalStore.getState().clearPrincipal();
    window.location.assign('/xo/login');
  }
}

export function XoLayout() {
  const me = useMeStore((s) => s.me);
  const { theme, toggleTheme } = useTheme();
  const layout = useLayout();
  if (!me) return null;
  if (!canUseXo(me)) return <NotForYou onSignOut={leave} />;
  return (
    // dvh, not vh: on a phone 100vh reaches under the browser's own toolbar, which hid the
    // bottom bar (Available / Running / History / Schedules).
    <div className="flex h-dvh flex-col">
      <AppHeader
        appName="Mission XO"
        buildVersion={__APP_VERSION__}
        tagline="Runs the day's workflows"
        helpHref="/xo/help.html"
        theme={theme}
        onToggleTheme={toggleTheme}
        userName={me.displayName}
        onSignOut={leave}
        // Phones show the switcher in its own row (WorkCenterShell): the top bar has no room.
        tools={layout === 'phone' ? undefined : <WorkCenterSwitcher />}
      />
      <div className="min-h-0 flex-1"><Outlet /></div>
    </div>
  );
}

export function XoUnreachable() {
  const router = useRouter();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-medium">Can't reach Mission Control</p>
      <Button variant="outline" onClick={() => { void router.invalidate(); }}>Retry</Button>
    </div>
  );
}

function WorkCenterSwitcher() {
  const name = useWorkCenterStore((s) => s.name);
  return name ? <SwitcherButton name={name} /> : null;
}
