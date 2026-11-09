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
import { useEffect } from 'react';
import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from '@tanstack/react-router';
import { workCenters } from '@/lib/api/work-centers';
import { useMeStore } from '~/stores/meStore';
import { useWorkCenterStore } from '~/stores/workCenterStore';
import { workCenterMode } from '~/lib/access';
import { writeLastWorkCenter } from '~/lib/last-work-center';
import { ConnectionProvider } from '~/components/running/connection';
import { WorkCenterShell, xoViewFromPath } from '~/components/shell/WorkCenterShell';
import { useScheduleAttention } from '~/lib/useScheduleAttention';

type WcNodes = Awaited<ReturnType<typeof workCenters.list>>['nodes'];

// The last list that loaded. Every tap re-runs this loader; while the work center is in it, the
// tap uses it at once and refreshes it in the background, so a lost connection keeps the screen
// (and its Not-connected banner) instead of failing the route. Only with no list at all does a
// failed fetch reach the error screen.
let lastNodes: WcNodes | null = null;

async function loadNodes(wcId: string): Promise<WcNodes> {
  const refresh = workCenters.list().then(({ nodes }) => { lastNodes = nodes; return nodes; });
  if (lastNodes?.some((n) => n.id === wcId)) {
    refresh.catch(() => { /* offline: keep the last list */ });
    return lastNodes;
  }
  try {
    return await refresh;
  } catch (e) {
    if (lastNodes) return lastNodes;
    throw e;
  }
}

export const Route = createFileRoute('/_xo/wc/$wcId')({
  loader: async ({ params }) => {
    const nodes = await loadNodes(params.wcId);
    const node = nodes.find((n) => n.id === params.wcId);
    if (!node) throw redirect({ to: '/' });
    return { name: node.name };
  },
  component: WorkCenterLayout,
});

function WorkCenterLayout() {
  const { wcId } = Route.useParams();
  const { name } = Route.useLoaderData();
  const me = useMeStore((s) => s.me);
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const setName = useWorkCenterStore((s) => s.set);

  useEffect(() => {
    writeLastWorkCenter(wcId);
    setName(name);
    return () => setName(null);
  }, [wcId, name, setName]);

  const active = xoViewFromPath(path);
  const scheduleAttention = useScheduleAttention(wcId, active);

  if (!me) return null;
  return (
    <ConnectionProvider>
    <WorkCenterShell
      wc={{ id: wcId, name, mode: workCenterMode(me, wcId) }}
      active={active}
      scheduleAttention={scheduleAttention}
      onSelect={(view) => { void navigate({ to: `/wc/$wcId/${view}`, params: { wcId } }); }}
    >
      <Outlet />
    </WorkCenterShell>
    </ConnectionProvider>
  );
}
