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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import * as wc from '@/lib/api/work-centers';
import type { WorkCenter } from '@/lib/api/types';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { WorkCenterDialog } from './WorkCenterDialog';

beforeEach(() => vi.clearAllMocks());
// This config does not enable Vitest globals, so @testing-library/react cannot
// auto-register its afterEach(cleanup). Without this, each render() leaks its DOM
// into document.body and later getByRole/getByText calls match duplicates.
afterEach(cleanup);

describe('WorkCenterDialog (create)', () => {
  it('validates required name', async () => {
    // The plan's original assertion called .not.toHaveBeenCalled() on an un-spied
    // method — the matcher THROWS on a non-mock. Spy create first so it's a real mock.
    const createSpy = vi.spyOn(wc.workCenters, 'create').mockResolvedValue({ workCenter: { id: 'x', name: 'x' } } as never);
    render(<WorkCenterDialog open initial={null} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });
  it('creates a root work center', async () => {
    const created = { workCenter: { id: 'new', name: 'Ops' } } as never;
    vi.spyOn(wc.workCenters, 'create').mockResolvedValue(created);
    const onSaved = vi.fn();
    render(<WorkCenterDialog open initial={null} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText(/name/i), 'Ops');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(wc.workCenters.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ops', parentWorkCenterId: null })));
    expect(toast.success).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(created);
  });
  it('surfaces a 409 name conflict as a toast', async () => {
    const { ApiError } = await import('@/lib/api/client');
    vi.spyOn(wc.workCenters, 'create').mockRejectedValue(new ApiError(409, 'conflict', 'Name already in use'));
    render(<WorkCenterDialog open initial={null} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText(/name/i), 'Dup');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Name already in use'));
  });
  // Ledger-mandated Select-mount carry: drive the dispatch-policy Select through a
  // real open+choose to prove the vitest.setup.ts Radix pointer/scroll shims are
  // load-bearing. If the Select fights jsdom, that IS signal — report, don't delete.
  it('submits the dispatch policy chosen from the Select', async () => {
    const created = { workCenter: { id: 'new', name: 'Ops' } } as never;
    const createSpy = vi.spyOn(wc.workCenters, 'create').mockResolvedValue(created);
    render(<WorkCenterDialog open initial={null} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText(/name/i), 'Ops');
    await userEvent.click(screen.getByRole('combobox', { name: 'Dispatch policy' }));
    await userEvent.click(await screen.findByRole('option', { name: /manual/i }));
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ dispatchPolicy: 'manual' })));
  });

  it('submits autoClaim true when the checkbox is checked; false by default', async () => {
    const created = { workCenter: { id: 'new', name: 'Ops' } } as never;
    const createSpy = vi.spyOn(wc.workCenters, 'create').mockResolvedValue(created);
    render(<WorkCenterDialog open initial={null} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText(/name/i), 'Ops');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ autoClaim: false })));

    createSpy.mockClear();
    await userEvent.click(screen.getByLabelText('Auto-claim follow-on steps'));
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ autoClaim: true })));
  });

  it('inserts a token at the cursor and previews three consecutive labels', async () => {
    render(<WorkCenterDialog open initial={null} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);
    const field = screen.getByLabelText('Runtime ID format') as HTMLInputElement;
    await userEvent.clear(field);
    await userEvent.type(field, 'MIX-');
    await userEvent.click(screen.getByRole('button', { name: 'Insert Sequence' }));
    expect(field.value).toBe('MIX-{SEQ}');
    const preview = await screen.findByTestId('runtime-id-preview');
    expect(preview.textContent).toContain('MIX-1');
    expect(preview.textContent).toContain('MIX-2');
    expect(preview.textContent).toContain('MIX-3');
  });

  // userEvent.type always leaves the caret at the end, so a test built only that way
  // cannot distinguish a real cursor-position insert from a naive `template + token`
  // append — both would produce the same result. This drives the caret to the MIDDLE
  // of the field (via setSelectionRange, not userEvent.type) before inserting, so only
  // a true cursor-aware insert lands the token between the two halves.
  it('inserts a token at a non-trailing caret position, not appended at the end', async () => {
    render(<WorkCenterDialog open initial={null} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);
    const field = screen.getByLabelText('Runtime ID format') as HTMLInputElement;
    await userEvent.clear(field);
    await userEvent.type(field, 'PREFIX-SUFFIX');
    field.setSelectionRange(7, 7); // right after 'PREFIX-', before 'SUFFIX'
    await userEvent.click(screen.getByRole('button', { name: 'Insert Sequence' }));
    expect(field.value).toBe('PREFIX-{SEQ}SUFFIX');
  });

  // A blank template is valid (it means "use the built-in default"), so the preview is
  // never empty — this pins the wording that tells the user WHICH mode they're in.
  it('names the built-in default in the preview when the format is left blank', async () => {
    render(<WorkCenterDialog open initial={null} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);
    const preview = await screen.findByTestId('runtime-id-preview');
    expect(preview.textContent).toMatch(/built-in default/i);
    expect(preview.textContent).toContain('RW-1');
    expect(preview.textContent).toContain('RW-2');
    expect(preview.textContent).toContain('RW-3');
  });

  it('shows the inline rule when {SEQ} is missing and blocks submit', async () => {
    render(<WorkCenterDialog open initial={null} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText('Name'), 'WC-1');
    await userEvent.type(screen.getByLabelText('Runtime ID format'), 'MIX-{YYYY}');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/must contain \{SEQ\}/i)).toBeInTheDocument();
  });

  it('leaves the format blank by default so an unconfigured work center keeps RW-n', () => {
    render(<WorkCenterDialog open initial={null} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);
    expect((screen.getByLabelText('Runtime ID format') as HTMLInputElement).value).toBe('');
  });
});

describe('WorkCenterDialog (edit)', () => {
  // Every test above renders with initial={null}, so isEdit is false and the Parent
  // field's Controller branch never mounts. These tests exist because fix round 1's
  // regression (visible label collapsing onto the accessible name) would still ship
  // green without a test that actually mounts this branch.
  const initial: WorkCenter = {
    id: 'self', name: 'Self WC', description: null, parentWorkCenterId: null,
    sortOrder: 0, dispatchPolicy: 'manual', autoClaim: true, runtimeIdTemplate: null, typeName: null, createdAt: '', updatedAt: '',
  };

  it('seeds the auto-claim checkbox from the initial work center', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({ nodes: [] } as never);
    render(<WorkCenterDialog open initial={initial} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);
    expect(screen.getByLabelText('Auto-claim follow-on steps')).toBeChecked();
  });

  it('renders the Parent field with a visible label distinct from its accessible name', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({
      nodes: [
        { id: 'self', name: 'Self WC', parentWorkCenterId: null, depth: 0, typeName: null },
        { id: 'other', name: 'Other WC', parentWorkCenterId: null, depth: 0, typeName: null },
      ],
    } as never);
    render(<WorkCenterDialog open initial={initial} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);

    await waitFor(() => expect(wc.workCenters.list).toHaveBeenCalled());
    // Visible label — the round-1 regression changed this text.
    expect(screen.getByText('Parent')).toBeInTheDocument();
    // Accessible name — getByLabelText can't distinguish this from the visible text
    // (it matches either a <label for> OR an aria-label), so this must be role-based.
    expect(screen.getByRole('combobox', { name: 'Parent work center' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Parent' })).not.toBeInTheDocument();
  });

  // Regression: extracting WorkCenterSelect (spec §9, shared with ImportPackageDialog's
  // parent/target pickers) changed the root option's text from "(root)" to "(as a new root)"
  // for EVERY caller, including this one. In edit mode the field reparents an EXISTING work
  // center — "(as a new root)" is the import dialog's wording ("create loads the package as a
  // new work center"), and is wrong here. Product copy is never changed to suit code or tests
  // (project convention) — this pins the restored wording.
  it('offers "(root)", not "(as a new root)", as the no-parent option', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({
      nodes: [{ id: 'self', name: 'Self WC', parentWorkCenterId: null, depth: 0, typeName: null }],
    } as never);
    render(<WorkCenterDialog open initial={initial} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);

    await waitFor(() => expect(wc.workCenters.list).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('combobox', { name: 'Parent work center' }));
    expect(await screen.findByRole('option', { name: '(root)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '(as a new root)' })).not.toBeInTheDocument();
  });

  // excludeId={initial?.id} has no coverage anywhere else. This exercises it through
  // WorkCenterDialog's real wiring, not the WorkCenterSelect unit in isolation.
  it('excludes the work center being edited from its own parent options', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({
      nodes: [
        { id: 'self', name: 'Self WC', parentWorkCenterId: null, depth: 0, typeName: null },
        { id: 'other', name: 'Other WC', parentWorkCenterId: null, depth: 0, typeName: null },
      ],
    } as never);
    render(<WorkCenterDialog open initial={initial} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);

    await waitFor(() => expect(wc.workCenters.list).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('combobox', { name: 'Parent work center' }));
    expect(await screen.findByRole('option', { name: 'Other WC' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Self WC' })).not.toBeInTheDocument();
  });
});

const WC_TYPES = ['Enterprise', 'Site', 'Area', 'Plant Area', 'Work Unit', 'Device', 'Process Cell', 'Unit', 'Production Line', 'Production Unit', 'Storage Zone', 'Storage Unit', 'Equipment'];

describe('WorkCenterDialog Type field', () => {
  const renderCreate = () => render(<WorkCenterDialog open initial={null} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);
  it('has a Type combo box with placeholder None and the 13 suggestions in order', () => {
    renderCreate();
    const input = screen.getByLabelText('Type') as HTMLInputElement;
    expect(input.placeholder).toBe('None');
    const list = document.getElementById(input.getAttribute('list')!)!;
    expect(Array.from(list.querySelectorAll('option')).map((o) => o.getAttribute('value'))).toEqual(WC_TYPES);
  });
  it('sends the trimmed type, and null when blank', async () => {
    const createSpy = vi.spyOn(wc.workCenters, 'create').mockResolvedValue({ workCenter: { id: 'n', name: 'Ops' } } as never);
    renderCreate();
    await userEvent.type(screen.getByLabelText('Name'), 'Ops');
    await userEvent.type(screen.getByLabelText('Type'), '  Production Line ');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ typeName: 'Production Line' })));
    cleanup();
    createSpy.mockClear();
    renderCreate();
    await userEvent.type(screen.getByLabelText('Name'), 'Ops');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ typeName: null })));
  });
  it('rejects a 51-character type without submitting', async () => {
    const createSpy = vi.spyOn(wc.workCenters, 'create').mockResolvedValue({ workCenter: { id: 'n', name: 'Ops' } } as never);
    renderCreate();
    await userEvent.type(screen.getByLabelText('Name'), 'Ops');
    await userEvent.type(screen.getByLabelText('Type'), 'x'.repeat(51));
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(await screen.findByText('Type must be 50 characters or fewer.')).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });
  it('seeds the field from initial.typeName in edit mode', () => {
    const initial = { id: 'w1', name: 'Line 1', description: null, parentWorkCenterId: null, sortOrder: 0, dispatchPolicy: 'manual', autoClaim: false, runtimeIdTemplate: null, typeName: 'Site', createdAt: '', updatedAt: '' } as WorkCenter;
    render(<WorkCenterDialog open initial={initial} parentWorkCenterId={null} onOpenChange={() => {}} onSaved={() => {}} />);
    expect((screen.getByLabelText('Type') as HTMLInputElement).value).toBe('Site');
  });
});
