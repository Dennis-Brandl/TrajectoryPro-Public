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
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SharedValuePropertyView } from '@/lib/api/types';
import { ValuePropertyTable, FlatPropertyTable, groupByProperty, splitPropertyKey } from './ValuePropertyTable';

const entry = (over: Partial<SharedValuePropertyView>): SharedValuePropertyView => ({
  workCenterId: 'wc1', propertyName: 'Batch', entryName: 'Size', value: '5', annotation: false,
  definedByEnvSpecId: 'e1', orphaned: false, updatedAt: '2026-09-01T10:00:00Z', updatedByName: null, ...over,
});

afterEach(cleanup);

describe('ValuePropertyTable', () => {
  it('groups entries under their property, labels annotations and orphans, and names the updater', () => {
    render(<ValuePropertyTable emptyText="none" values={[
      entry({}),
      entry({ entryName: 'Description', value: 'Batch settings', annotation: true }),
      entry({ propertyName: 'Alarm', entryName: 'Limit', value: '90', updatedByName: 'Cmdr', orphaned: true, definedByEnvSpecId: null }),
    ]} />);
    const rows = screen.getAllByRole('row');
    // header row, then: Batch group, Batch.Size, Batch.Description, Alarm group, Alarm.Limit
    // (input order is Batch, Batch, Alarm; grouping preserves first-appearance order).
    expect(rows.map((r) => r.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Alarm'), expect.stringContaining('Batch')]));
    const limit = screen.getByRole('row', { name: /Limit/ });
    expect(within(limit).getByText('90')).toBeInTheDocument();
    expect(within(limit).getByText(/Cmdr/)).toBeInTheDocument();
    expect(within(limit).getByText('orphaned')).toBeInTheDocument();
    const description = screen.getByRole('row', { name: /Description/ });
    expect(within(description).getByText('annotation')).toBeInTheDocument();
  });

  it('shows the empty text and renders an empty value as (empty)', () => {
    render(<ValuePropertyTable emptyText="No values" values={[]} />);
    expect(screen.getByText('No values')).toBeInTheDocument();
    cleanup();
    render(<ValuePropertyTable emptyText="none" values={[entry({ value: '' })]} />);
    expect(screen.getByText('(empty)')).toBeInTheDocument();
  });
});

describe('FlatPropertyTable', () => {
  it('splits "Property.Entry" keys into groups; a key without a dot is its own group', () => {
    render(<FlatPropertyTable emptyText="none" values={{ 'Batch.Size': '5', 'Batch.Colour': 'red', Loose: 'x' }} />);
    expect(screen.getByRole('row', { name: /Size/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Colour/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Loose/ })).toBeInTheDocument();
    cleanup();
    render(<FlatPropertyTable emptyText="No flat values" values={{}} />);
    expect(screen.getByText('No flat values')).toBeInTheDocument();
  });

  it('groups a jsonb-ordered flat store by property in first-appearance order, not row adjacency (Postgres does not preserve jsonb key order)', () => {
    render(<FlatPropertyTable emptyText="none" values={{
      'Batch.Size': '5', 'Recipe.Name': 'Kitchen', 'Batch.Description': 'desc', 'Recipe.Temperature': '180',
    }} />);
    const rows = screen.getAllByRole('row');
    // Exactly two groups (Batch, then Recipe), each holding its own entries in input order —
    // the old consecutive grouper split this into four groups (Batch, Recipe, Batch, Recipe)
    // with duplicate Fragment keys.
    expect(rows.map((r) => r.textContent)).toEqual([
      'EntryValue',
      'Batch',
      'Size5',
      'Descriptiondesc',
      'Recipe',
      'NameKitchen',
      'Temperature180',
    ]);
  });
});

describe('helpers', () => {
  it('splitPropertyKey splits at the FIRST dot, matching the engine key format Property.Entry', () => {
    expect(splitPropertyKey('Batch.Size')).toEqual({ propertyName: 'Batch', entryName: 'Size' });
    expect(splitPropertyKey('A.B.C')).toEqual({ propertyName: 'A', entryName: 'B.C' });
    expect(splitPropertyKey('Loose')).toEqual({ propertyName: 'Loose', entryName: '' });
  });
  it('groupByProperty keeps server order within and across groups', () => {
    const g = groupByProperty([entry({ propertyName: 'A', entryName: 'x' }), entry({ propertyName: 'A', entryName: 'y' }), entry({ propertyName: 'B', entryName: 'z' })]);
    expect(g.map((x) => [x.propertyName, x.entries.map((e) => e.entryName)])).toEqual([['A', ['x', 'y']], ['B', ['z']]]);
  });
});

describe('inline editing (Phase 4b)', () => {
  it('without `edit` there is no Edit control; with it, a non-commander sees a disabled one with the reason', () => {
    render(<ValuePropertyTable values={[entry({})]} emptyText="none" />);
    expect(screen.queryByRole('button', { name: 'Edit Batch.Size' })).toBeNull();
    cleanup();
    render(<ValuePropertyTable values={[entry({})]} emptyText="none" edit={{ canCommand: false, busy: false, onSave: vi.fn() }} />);
    const edit = screen.getByRole('button', { name: 'Edit Batch.Size' });
    expect(edit).toBeDisabled();
    expect(edit).toHaveAttribute('title', 'Requires Mission System Commander');
  });

  it('Edit → input seeded with the current value → Save calls onSave once with the row and the new value; Cancel restores the cell', async () => {
    const onSave = vi.fn();
    render(<ValuePropertyTable values={[entry({})]} emptyText="none" edit={{ canCommand: true, busy: false, onSave, note: 'Shared with the work center.' }} />);
    expect(screen.getByText('Shared with the work center.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Batch.Size' }));
    const input = screen.getByRole('textbox', { name: 'New value for Batch.Size' });
    expect(input).toHaveValue('5');
    await userEvent.clear(input);
    await userEvent.type(input, '7');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(within(screen.getByRole('row', { name: /Size/ })).getByText('5')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Edit Batch.Size' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'New value for Batch.Size' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New value for Batch.Size' }), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ propertyName: 'Batch', entryName: 'Size' }), '7');
    expect(screen.queryByRole('textbox')).toBeNull(); // the table shows the last-known value until the refresh lands (no optimistic write)
  });

  it('FlatPropertyTable edits by flat key', async () => {
    const onSave = vi.fn();
    render(<FlatPropertyTable values={{ 'Batch.Size': '5', Note: 'x' }} emptyText="none" edit={{ canCommand: true, busy: false, onSave }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Batch.Size' }));
    const input = screen.getByRole('textbox', { name: 'New value for Batch.Size' });
    await userEvent.clear(input);
    await userEvent.type(input, '9');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('Batch.Size', '9');
    expect(screen.getByRole('button', { name: 'Edit Note' })).toBeInTheDocument(); // a dot-less key is its own group and still editable
  });
});
