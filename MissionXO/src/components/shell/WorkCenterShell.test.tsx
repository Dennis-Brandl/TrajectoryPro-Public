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
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { WorkCenterShell, xoViewFromPath } from './WorkCenterShell';

function setWidth(px: number) {
  window.matchMedia = ((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      matches: px >= min, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

const wc = (mode: 'full' | 'view-only') => ({ id: 'a', name: 'Alpha', mode });
const show = (mode: 'full' | 'view-only' = 'full', onSelect = vi.fn()) =>
  render(<WorkCenterShell wc={wc(mode)} active="running" onSelect={onSelect}><p>body</p></WorkCenterShell>);

afterEach(cleanup);

describe('WorkCenterShell', () => {
  it('renders a rail at 1440 px', () => {
    setWidth(1440);
    show();
    expect(screen.getByTestId('xo-rail')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByTestId('xo-bottom-bar')).toBeNull();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders tabs at 1024 px', () => {
    setWidth(1024);
    show();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Available', 'Running', 'History', 'Schedules']);
    expect(screen.queryByTestId('xo-rail')).toBeNull();
  });

  it('renders a bottom bar at 390 px', () => {
    setWidth(390);
    show();
    expect(screen.getByTestId('xo-bottom-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('xo-rail')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it.each([1440, 1024, 390])('selects a view at %i px', (w) => {
    setWidth(w);
    const onSelect = vi.fn();
    show('full', onSelect);
    const target = screen.getAllByText('History')[0];
    fireEvent.mouseDown(target);
    fireEvent.click(target);
    expect(onSelect).toHaveBeenCalledWith('history');
  });

  it('shows the banner only in view-only mode', () => {
    setWidth(1440);
    show('full');
    expect(screen.queryByText(/View only/)).toBeNull();
    cleanup();
    show('view-only');
    expect(screen.getByText('View only — you are not a Mission System Commander in this work center.')).toBeInTheDocument();
  });

  it('puts four items in a four-column bottom bar at 390 px', () => {
    setWidth(390);
    show();
    const bar = screen.getByTestId('xo-bottom-bar');
    expect(bar.className).toContain('grid-cols-4');
    expect(bar.textContent).toBe('AvailableRunningHistorySchedules');
  });

  it.each([1440, 390])('selects Schedules at %i px', (w) => {
    setWidth(w);
    const onSelect = vi.fn();
    show('full', onSelect);
    fireEvent.click(screen.getByText('Schedules'));
    expect(onSelect).toHaveBeenCalledWith('schedules');
  });

  it.each([1440, 1024, 390])('shows the Needs attention count on Schedules at %i px, and nothing at zero', (w) => {
    setWidth(w);
    render(<WorkCenterShell wc={wc('full')} active="running" onSelect={vi.fn()} scheduleAttention={2}><p>body</p></WorkCenterShell>);
    expect(screen.getByLabelText('2 need attention')).toHaveTextContent('2');
    cleanup();
    render(<WorkCenterShell wc={wc('full')} active="running" onSelect={vi.fn()} scheduleAttention={0}><p>body</p></WorkCenterShell>);
    expect(screen.queryByLabelText(/need attention/)).toBeNull();
  });
});

describe('xoViewFromPath', () => {
  it.each([
    ['/xo/wc/a/running', 'running'], ['/xo/wc/a/running/r1', 'running'], ['/xo/wc/a/new/w1', 'new'],
    ['/xo/wc/a/history/h1', 'history'], ['/xo/wc/a/schedules', 'schedules'], ['/xo/wc/a/schedules/s1', 'schedules'],
  ])('%s is %s', (path, view) => expect(xoViewFromPath(path)).toBe(view));
  it('defaults to running', () => expect(xoViewFromPath('/xo/wc/a')).toBe('running'));
});
