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
import { DispatchPolicySelect } from './DispatchPolicySelect';

afterEach(cleanup);

describe('DispatchPolicySelect', () => {
  it('renders all six policy options', async () => {
    render(<DispatchPolicySelect value={null} onChange={() => {}} />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByRole('option', { name: 'Inherit work-center default' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Manual (pull only)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Least queued steps' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Highest priority' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Round robin' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Fewest active instances' })).toBeInTheDocument();
  });

  it('shows "Inherit work-center default" selected when value is null', () => {
    render(<DispatchPolicySelect value={null} onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Inherit work-center default');
  });

  it('calls onChange with the policy string when a non-inherit option is chosen', async () => {
    const onChange = vi.fn();
    render(<DispatchPolicySelect value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Manual (pull only)' }));
    expect(onChange).toHaveBeenCalledWith('manual');
  });

  it('calls onChange with null when Inherit work-center default is chosen', async () => {
    const onChange = vi.fn();
    render(<DispatchPolicySelect value="manual" onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'Inherit work-center default' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('renders the helper text verbatim', () => {
    render(<DispatchPolicySelect value={null} onChange={() => {}} />);
    expect(screen.getByText('Suggests tasks to operators; any eligible operator may claim')).toBeInTheDocument();
  });

  it('respects the disabled prop', () => {
    render(<DispatchPolicySelect value={null} onChange={() => {}} disabled />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
