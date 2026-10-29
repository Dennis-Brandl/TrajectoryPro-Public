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
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryPager } from './HistoryPager';

afterEach(cleanup);

describe('HistoryPager', () => {
  it('renders nothing when there is at most one page', () => {
    const { container } = render(<HistoryPager page={1} pageCount={1} onPage={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows "Page X of Y" and disables Prev on the first page', async () => {
    const onPage = vi.fn();
    render(<HistoryPager page={1} pageCount={3} onPage={onPage} />);
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('disables Next on the last page and calls onPage(page - 1) from Prev', async () => {
    const onPage = vi.fn();
    render(<HistoryPager page={3} pageCount={3} onPage={onPage} />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Prev' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});
