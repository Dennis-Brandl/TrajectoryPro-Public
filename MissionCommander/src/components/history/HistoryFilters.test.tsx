// @vitest-environment jsdom
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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RuntimeHistoryListParams } from '@/lib/api/types';
import { HistoryFilters } from './HistoryFilters';

afterEach(cleanup);

const BASE: RuntimeHistoryListParams = { page: 3 };

describe('HistoryFilters', () => {
  it('renders all five state chips', () => {
    render(<HistoryFilters value={BASE} onChange={vi.fn()} />);
    for (const name of ['All', 'Completed', 'Stopped', 'Aborted', 'Errored']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('clicking a state chip commits that state and resets page to 1', async () => {
    const onChange = vi.fn();
    render(<HistoryFilters value={BASE} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Completed' }));
    expect(onChange).toHaveBeenCalledWith({ page: 1, state: 'completed' });
  });

  it('clicking All clears an existing state (single-select) and resets page to 1', async () => {
    const onChange = vi.fn();
    render(<HistoryFilters value={{ ...BASE, state: 'errored' }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith({ page: 1, state: undefined });
  });

  it('search commits on Enter with the typed text and page reset to 1', async () => {
    const onChange = vi.fn();
    render(<HistoryFilters value={BASE} onChange={onChange} />);
    const search = screen.getByLabelText('Search');
    await userEvent.type(search, 'bottle{Enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ page: 1, search: 'bottle' });
  });

  it('search commits on blur (no Enter) with the typed text and page reset to 1', async () => {
    const onChange = vi.fn();
    render(<HistoryFilters value={BASE} onChange={onChange} />);
    const search = screen.getByLabelText('Search');
    await userEvent.type(search, 'bottle');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ page: 1, search: 'bottle' });
  });

  // Ticket 2: blur is a very common, non-intentional event (tab-through, window-blur,
  // clicking elsewhere to read something) — committing unconditionally on blur means an
  // untouched focus-through resets page to 1 and refires the fetch for no reason. Enter is
  // deliberate keyboard intent and keeps committing unconditionally either way (see the two
  // tests below): the asymmetry is by design, not an oversight.
  it('blur with the search text unchanged from the committed value does NOT call onChange', async () => {
    const onChange = vi.fn();
    render(<HistoryFilters value={{ ...BASE, search: 'bottle' }} onChange={onChange} />);
    const search = screen.getByLabelText('Search');
    await userEvent.click(search); // focus, no edit
    await userEvent.tab();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('blur with the search text changed from the committed value DOES call onChange, with page reset to 1', async () => {
    const onChange = vi.fn();
    render(<HistoryFilters value={{ ...BASE, search: 'bottle' }} onChange={onChange} />);
    const search = screen.getByLabelText('Search');
    await userEvent.clear(search);
    await userEvent.type(search, 'crate');
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...BASE, page: 1, search: 'crate' });
  });

  it('Enter commits unconditionally even when the search text is unchanged from the committed value', async () => {
    const onChange = vi.fn();
    render(<HistoryFilters value={{ ...BASE, search: 'bottle' }} onChange={onChange} />);
    const search = screen.getByLabelText('Search');
    await userEvent.type(search, '{Enter}'); // no edit, just Enter
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...BASE, page: 1, search: 'bottle' });
  });

  it('changing the From date commits it and resets page to 1', () => {
    const onChange = vi.fn();
    render(<HistoryFilters value={BASE} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-01T00:00' } });
    expect(onChange).toHaveBeenCalledWith({ page: 1, from: '2026-08-01T00:00' });
  });

  it('changing the To date commits it and resets page to 1', () => {
    const onChange = vi.fn();
    render(<HistoryFilters value={BASE} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-02T00:00' } });
    expect(onChange).toHaveBeenCalledWith({ page: 1, to: '2026-08-02T00:00' });
  });

  it('Refresh calls onChange with the current filters unchanged except page reset to 1', async () => {
    const onChange = vi.fn();
    render(<HistoryFilters value={{ state: 'aborted', search: 'x', page: 4 }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onChange).toHaveBeenCalledWith({ state: 'aborted', search: 'x', page: 1 });
  });
});
