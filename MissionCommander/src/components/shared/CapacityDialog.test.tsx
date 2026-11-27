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
import { CapacityDialog, capacityLabel } from './CapacityDialog';
import type { ResourceTableRow } from './ResourceTable';

const row = (over: Partial<ResourceTableRow>): ResourceTableRow => ({
  key: 'env:Scales', scope: 'environment', name: 'Scales', resourceType: 'countable use with pool limits', state: '1/2 in use',
  holders: [], waiters: [], unaccounted: 0, untrackedNames: [], inUse: 1, ledgerMismatch: false, overCommitted: false,
  definedBy: null, orphaned: false, target: { tier: 'environment', workCenterId: 'w1', name: 'Scales' },
  capacity: { useLimit: 2, poolNames: [], heldNames: [], designerDefault: { useLimit: 3, names: [] }, setBy: null, setAt: null },
  ...over,
} as ResourceTableRow);
const onSave = vi.fn();
const onClose = vi.fn();
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('CapacityDialog', () => {
  it('names the action by type', () => {
    expect(capacityLabel('binary shared use with pool limits')).toBe('Change shares…');
    expect(capacityLabel('countable use with pool limits')).toBe('Change count…');
    expect(capacityLabel('named pool')).toBe('Change names…');
    expect(capacityLabel('binary exclusive use')).toBeNull();
    expect(capacityLabel('sync')).toBeNull();
  });

  it('a count shows Designer’s value and saves the new number', async () => {
    render(<CapacityDialog row={row({})} busy={false} onSave={onSave} onClose={onClose} />);
    expect(screen.getByText('Designer’s value: 3')).toBeInTheDocument();
    const box = screen.getByLabelText('Count');
    expect(box).toHaveValue(2);
    fireEvent.change(box, { target: { value: '4' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ name: 'Scales', useLimit: 4 });
  });

  it('lowering below what is in use says what happens; 0 is refused', async () => {
    render(<CapacityDialog row={row({ inUse: 3, capacity: { useLimit: 4, poolNames: [], heldNames: [], designerDefault: null, setBy: null, setAt: null } })} busy={false} onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '2' } });
    expect(screen.getByText('3 are in use; they finish, and nothing new starts until there is room.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Enter a whole number of at least 1.')).toBeInTheDocument();
  });

  it('shares are labelled Shares', () => {
    render(<CapacityDialog row={row({ resourceType: 'binary shared use with pool limits' })} busy={false} onSave={onSave} onClose={onClose} />);
    expect(screen.getByLabelText('Shares')).toBeInTheDocument();
  });

  it('names: one per line, trimmed, blank lines dropped; a held name that is removed is called out', async () => {
    const named = row({
      name: 'Docks', resourceType: 'named pool',
      capacity: { useLimit: null, poolNames: ['D1', 'D2'], heldNames: ['D2'], designerDefault: { useLimit: null, names: ['Dock A'] }, setBy: null, setAt: null },
    });
    render(<CapacityDialog row={named} busy={false} onSave={onSave} onClose={onClose} />);
    expect(screen.getByText('Designer’s names: Dock A')).toBeInTheDocument();
    const box = screen.getByLabelText('Names, one per line');
    expect(box).toHaveValue('D1\nD2');
    fireEvent.change(box, { target: { value: ' North \n\nD1\n' } });
    expect(screen.getByText('D2 is in use; it finishes, then is not handed out again.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ name: 'Docks', names: ['North', 'D1'] });
  });

  it('names: duplicates or an empty list are refused', () => {
    const named = row({ name: 'Docks', resourceType: 'named pool', capacity: { useLimit: null, poolNames: ['D1'], heldNames: [], designerDefault: null, setBy: null, setAt: null } });
    render(<CapacityDialog row={named} busy={false} onSave={onSave} onClose={onClose} />);
    const box = screen.getByLabelText('Names, one per line');
    fireEvent.change(box, { target: { value: 'A\n A ' } });
    expect(screen.getByText('"A" is listed twice.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(box, { target: { value: '  \n' } });
    expect(screen.getByText('Enter at least one name.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
