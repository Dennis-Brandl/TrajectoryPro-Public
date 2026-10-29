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
import { Sun, Moon } from 'lucide-react';
import { authClient, signOut } from '@/lib/auth/auth-client';
import { getSetupStatus } from '@/lib/auth/setupClient';
import { runBoot } from '@/lib/auth/boot';
import { usePrincipalStore } from '@/stores/principalStore';
import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/ui/button';
import { ImpersonationBanner } from '@/components/shell/ImpersonationBanner';
import bannerUrl from '@/assets/mission-commander.png';
import bannerDarkUrl from '@/assets/mission-commander-dark.png';

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
  const logout = async () => { await signOut(); usePrincipalStore.getState().clearPrincipal(); navigate({ to: '/login' }); };
  return (
    <div className="flex h-screen flex-col">
      {/*
        Three equal-outer-track grid rather than a justify-between flex: the banner has to be
        centred on the VIEWPORT, and with flex it would only land centre when the left title
        and the right session controls happened to be the same width — so it would drift as
        the signed-in display name changes length. `1fr auto 1fr` pins it regardless.

        The banner is an INFORMATION GRAPHIC, not a logo — its labels have to stay readable, so
        its height is what we protect and the text around it is what gives way. It is very wide,
        so height drives width hard: at `h-19` the light art (8.15:1) renders ~619px and the
        dark (7.82:1) ~594px. Below ~1280px that no longer leaves room for a title, a display
        name and a Sign-out button all at once.

        The two ratios differ ON PURPOSE, and the mismatch is not worth "fixing": the dark
        artwork wraps "UI Steps are assigned to" onto two lines, which makes it relatively
        taller, so the diagram renders ~5.5% smaller in dark mode. Both images' backgrounds are
        painted to match their theme's --background exactly (white; RGB 38,38,38 against a
        RGB 37,37,37 header), so neither has a visible edge and the size shift reads as nothing
        at all next to the full colour-scheme change happening at the same moment. Padding the
        light art to match would only trade that for a smaller light diagram, and the differing
        label means the two can never look identical regardless.

        So the two text labels are all-or-nothing at `xl` rather than truncating — a clipped
        "Mission Comman…" reads as a bug, and these are the only two things here that
        are safe to drop entirely. With them gone the diagram keeps its full height all the way
        down to `lg`, and only starts stepping below that, where nothing else competes for the
        width.

        RE-MEASURED 2026-07-31, after both the theme toggle (a fixed ~32px icon button in the
        right-hand group) and the real banner artwork landed. Driven through a real browser at
        all six widths in BOTH themes, asserting scrollWidth <= clientWidth on the document and
        on this header — no horizontal overflow at any of the twelve combinations:

            width   1440  1280  1024   900   768   640
            light    619   619   619   456   456   326
            dark     594   594   594   438   438   313   (rendered banner width, px)

        The 2026-09-09 rebrand shortened the left label from "Trajectory Command Module" to
        "Mission Commander" (25 chars -> 17). The table above measures the BANNER IMAGE, not
        the labels, so it still holds unchanged; the rename only relieves the budget further.

        The real art is NARROWER than the placeholder it replaced (~652px at `h-19`), so it
        relieves this budget rather than straining it. If a future change does overflow, shrink
        the banner's `lg:h-19` step rather than hiding the toggle.

        `col-start-*` is load-bearing: `hidden` is `display:none`, which removes an element
        from the grid ENTIRELY rather than leaving an empty cell — without explicit placement
        the banner would slide into column 1 and stop being centred at exactly the widths this
        is meant to fix.
      */}
      <header className="grid h-24 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b px-4">
        <span className="col-start-1 hidden truncate font-semibold xl:block">Mission Commander</span>
        <img
          src={theme === 'dark' ? bannerDarkUrl : bannerUrl}
          alt="Environments and master workflows load into work centers, which execute runtime workflows; runtime workflows use environments; users are assigned to work centers and given roles"
          className="col-start-2 h-10 w-auto object-contain md:h-14 lg:h-19"
        />
        <div className="col-start-3 flex min-w-0 items-center justify-end gap-3 text-sm">
          <span className="hidden truncate text-muted-foreground xl:inline">{principal?.displayName}</span>
          {/*
            Unlike the two text labels, which are all-or-nothing at `xl` because a clipped
            "Mission Comman…" reads as a bug, this is a fixed ~32px icon button and
            stays visible at every width. See the header comment above for the width budget.
          */}
          <Button
            variant="ghost" size="sm" onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={logout}>Sign out</Button>
        </div>
      </header>
      <ImpersonationBanner />
      <div className="min-h-0 flex-1"><Outlet /></div>
    </div>
  );
}
