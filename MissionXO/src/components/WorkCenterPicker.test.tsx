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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/work-centers', () => ({ workCenters: { list: vi.fn() } }));

import { WorkCenterPicker } from './WorkCenterPicker';
import { workCenters } from '@/lib/api/work-centers';
import { useMeStore } from '~/stores/meStore';
import { readLastWorkCenter, writeLastWorkCenter } from '~/lib/last-work-center';
import type { MePrincipal } from '@/lib/api/types';

const node = (id: string, name: string, typeName: string | null = null) =>
  ({ id, name, typeName, parentWorkCenterId: null, depth: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useMeStore.setState({
    me: { isAdministrator: false, missionSystemCommanderOf: ['a'] } as unknown as MePrincipal,
  });
});
afterEach(cleanup);

describe('WorkCenterPicker', () => {
  it('lists full rows first and labels only view-only rows', async () => {
    vi.mocked(workCenters.list).mockResolvedValue({ nodes: [node('b', 'Bravo', 'Line'), node('a', 'Alpha')] });
    render(<WorkCenterPicker onChoose={vi.fn()} />);
    await screen.findByText('Alpha');
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('Alpha');
    expect(buttons[1]).toHaveTextContent('Bravo');
    expect(buttons[0]).not.toHaveTextContent('View only');
    expect(buttons[1]).toHaveTextContent('View only');
    expect(screen.getByText('Line')).toBeInTheDocument();
  });

  it('opens the remembered work center and skips the list', async () => {
    writeLastWorkCenter('a');
    vi.mocked(workCenters.list).mockResolvedValue({ nodes: [node('a', 'Alpha'), node('b', 'Bravo')] });
    const onChoose = vi.fn();
    render(<WorkCenterPicker onChoose={onChoose} />);
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith('a'));
  });

  it('shows the list and does not navigate when pick is set', async () => {
    writeLastWorkCenter('a');
    vi.mocked(workCenters.list).mockResolvedValue({ nodes: [node('a', 'Alpha'), node('b', 'Bravo')] });
    const onChoose = vi.fn();
    render(<WorkCenterPicker pick onChoose={onChoose} />);
    await screen.findByText('Bravo');
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('ignores a remembered id that no longer exists', async () => {
    writeLastWorkCenter('gone');
    vi.mocked(workCenters.list).mockResolvedValue({ nodes: [node('a', 'Alpha')] });
    const onChoose = vi.fn();
    render(<WorkCenterPicker onChoose={onChoose} />);
    await screen.findByText('Alpha');
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('remembers the chosen work center', async () => {
    vi.mocked(workCenters.list).mockResolvedValue({ nodes: [node('a', 'Alpha')] });
    const onChoose = vi.fn();
    render(<WorkCenterPicker onChoose={onChoose} />);
    fireEvent.click(await screen.findByText('Alpha'));
    expect(onChoose).toHaveBeenCalledWith('a');
    expect(readLastWorkCenter()).toBe('a');
  });

  it('shows the empty text', async () => {
    vi.mocked(workCenters.list).mockResolvedValue({ nodes: [] });
    render(<WorkCenterPicker onChoose={vi.fn()} />);
    expect(await screen.findByText('There are no work centers yet. They are set up in Mission Commander.')).toBeInTheDocument();
  });

  it('shows a search box only above 8 work centers and filters by name', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => node(`n${i}`, `Cell ${i}`));
    vi.mocked(workCenters.list).mockResolvedValue({ nodes: nine });
    render(<WorkCenterPicker onChoose={vi.fn()} />);
    const search = await screen.findByRole('searchbox');
    fireEvent.change(search, { target: { value: 'cell 3' } });
    expect(screen.getByText('Cell 3')).toBeInTheDocument();
    expect(screen.queryByText('Cell 4')).toBeNull();
  });

  it('has no search box for 8 or fewer', async () => {
    vi.mocked(workCenters.list).mockResolvedValue({ nodes: [node('a', 'Alpha')] });
    render(<WorkCenterPicker onChoose={vi.fn()} />);
    await screen.findByText('Alpha');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});
