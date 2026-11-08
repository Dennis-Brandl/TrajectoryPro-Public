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
import { WorkCenterShell } from './WorkCenterShell';

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
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Available', 'Running', 'History']);
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
});
