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
import { createContext, useContext, type ReactNode } from 'react';
import { Activity, CalendarDays, History, Plus, type LucideIcon } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@mission/ui';
import { cn } from '@/lib/utils';
import { useLayout } from '~/lib/layout';
import type { WcMode } from '~/lib/access';
import { ViewOnlyBanner } from './ViewOnlyBanner';

export type XoView = 'running' | 'new' | 'history' | 'schedules';

/** Which view a path belongs to, including a detail under it ("schedules/:id" is Schedules). */
export function xoViewFromPath(path: string): XoView {
  return (/\/wc\/[^/]+\/(running|new|history|schedules)/.exec(path)?.[1] as XoView | undefined) ?? 'running';
}
export type CurrentWorkCenter = { id: string; name: string; mode: WcMode };

const WorkCenterContext = createContext<CurrentWorkCenter | null>(null);

export function useWorkCenter(): CurrentWorkCenter {
  const wc = useContext(WorkCenterContext);
  if (!wc) throw new Error('useWorkCenter must be used inside a work center');
  return wc;
}

const ITEMS: { id: XoView; label: string; icon: LucideIcon }[] = [
  { id: 'new', label: 'Available', icon: Plus },
  { id: 'running', label: 'Running', icon: Activity },
  { id: 'history', label: 'History', icon: History },
  { id: 'schedules', label: 'Schedules', icon: CalendarDays },
];

type NavProps = { active: XoView; onSelect: (v: XoView) => void; attention: number };

/** How many Runtime Schedules need a person; nothing at zero. */
function AttentionCount({ n, className = 'ml-1' }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span aria-label={`${n} need attention`} className={cn('inline-flex min-w-4 items-center justify-center rounded-full bg-status-warn-bg px-1 text-[10px] font-semibold leading-4 text-status-warn-fg', className)}>
      {n > 9 ? '9+' : n}
    </span>
  );
}

// The suite ActivityRail is a 48 px icon-only strip; the approved XO screens call for a
// 72 px rail with a label under each icon, so XO draws its own with the same tokens.
function Rail({ active, onSelect, attention }: NavProps) {
  return (
    <nav data-testid="xo-rail" aria-label="Work center views" className="flex w-[72px] shrink-0 flex-col items-center gap-1 border-r border-border bg-activity-bar pt-2">
      {ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-current={id === active ? 'page' : undefined}
          onClick={() => onSelect(id)}
          className={cn(
            'flex w-16 flex-col items-center gap-1 rounded-lg py-2 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            id === active && 'bg-muted font-semibold text-foreground',
          )}
        >
          <span className="relative">
            <Icon className="size-5" />
            {id === 'schedules' && <AttentionCount n={attention} className="absolute -right-3 -top-1" />}
          </span>
          {label}
        </button>
      ))}
    </nav>
  );
}

function BottomBar({ active, onSelect, attention }: NavProps) {
  return (
    <nav data-testid="xo-bottom-bar" aria-label="Work center views" className="grid h-16 shrink-0 grid-cols-4 border-t border-border bg-background">
      {ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-current={id === active ? 'page' : undefined}
          onClick={() => onSelect(id)}
          className={cn(
            'flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground',
            id === active && 'font-semibold text-foreground',
          )}
        >
          <span className="relative">
            <Icon className="size-5" />
            {id === 'schedules' && <AttentionCount n={attention} className="absolute -right-3 -top-1" />}
          </span>
          {label}
        </button>
      ))}
    </nav>
  );
}

export function WorkCenterShell({ wc, active, onSelect, scheduleAttention = 0, children }: {
  wc: CurrentWorkCenter;
  active: XoView;
  onSelect: (view: XoView) => void;
  /** Runtime Schedules that need a person; shown beside Schedules. */
  scheduleAttention?: number;
  children: ReactNode;
}) {
  const layout = useLayout();
  const content = (
    <main className="min-h-0 min-w-0 flex-1 overflow-auto">
      {wc.mode === 'view-only' && <ViewOnlyBanner />}
      {children}
    </main>
  );
  let body: ReactNode;
  if (layout === 'desktop') {
    body = (
      <div className="flex h-full min-h-0">
        <Rail active={active} onSelect={onSelect} attention={scheduleAttention} />
        {content}
      </div>
    );
  } else if (layout === 'tablet') {
    body = (
      <div className="flex h-full min-h-0 flex-col">
        <Tabs value={active} onValueChange={(v) => onSelect(v as XoView)} className="shrink-0 border-b border-border">
          <TabsList className="h-auto w-full justify-start gap-2 rounded-none bg-transparent p-0 px-4">
            {ITEMS.map(({ id, label }) => (
              <TabsTrigger
                key={id}
                value={id}
                className="min-h-11 rounded-none border-b-2 border-transparent px-4 text-sm data-[state=active]:border-selection data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                {label}
                {id === 'schedules' && <AttentionCount n={scheduleAttention} />}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {content}
      </div>
    );
  } else {
    body = (
      <div className="flex h-full min-h-0 flex-col">
        {content}
        <BottomBar active={active} onSelect={onSelect} attention={scheduleAttention} />
      </div>
    );
  }
  return <WorkCenterContext.Provider value={wc}>{body}</WorkCenterContext.Provider>;
}
