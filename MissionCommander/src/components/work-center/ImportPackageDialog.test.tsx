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
import { usePrincipalStore } from '@/stores/principalStore';
import * as wc from '@/lib/api/work-centers';
import type { ImportReport } from '@/lib/api/types';

vi.mock('@/lib/api/package', () => ({ packages: { import: vi.fn() } }));
import { packages } from '@/lib/api/package';
import { ImportPackageDialog } from './ImportPackageDialog';

const doImport = packages.import as unknown as ReturnType<typeof vi.fn>;

const createReport: ImportReport = {
  rootWorkCenterId: 'wc-9',
  workCenters: { matched: 0, created: 2 },
  workflows: { created: 3, alreadyPresent: 1 },
  environments: { created: 1, alreadyPresent: 0 },
  links: { created: 2, alreadyPresent: 0 },
  roles: { created: 1 },
  grants: { created: 4, alreadyPresent: 0, unresolved: [] },
  configChanges: [],
  targetOnlyGrants: [],
  warnings: [],
};

// The report a merge preview (409) and a confirmed merge (200) share — same shape either
// way (spec §8.6). Carries one dispatchPolicy override so the "confirm shows configChanges
// first" assertion has a real row to find.
const mergeReport: ImportReport = {
  rootWorkCenterId: 'a',
  workCenters: { matched: 1, created: 0 },
  workflows: { created: 0, alreadyPresent: 1 },
  environments: { created: 0, alreadyPresent: 0 },
  links: { created: 0, alreadyPresent: 1 },
  roles: { created: 0 },
  grants: { created: 0, alreadyPresent: 0, unresolved: [] },
  configChanges: [
    {
      workCenterPath: 'Root',
      workflow: { oid: 'wf-1', version: '1.0.0', state: 'effective' },
      field: 'dispatchPolicy',
      from: 'least_queued_steps',
      to: 'round_robin',
    },
  ],
  targetOnlyGrants: [],
  warnings: [],
};

const file = (name: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'application/zip' });

const oneWorkCenter = (id: string, name: string) =>
  ({ nodes: [{ id, name, parentWorkCenterId: null, depth: 0, typeName: null }] }) as never;

beforeEach(() => {
  doImport.mockReset();
  doImport.mockResolvedValue(createReport);
  usePrincipalStore.getState().clearPrincipal();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const open = (onImported = vi.fn()) => render(
  <ImportPackageDialog open onOpenChange={() => {}} onImported={onImported} />,
);

// Exact string, NOT /package/i: the DialogTitle legitimately reads "Import a work-center
// package" (product copy over test convenience — see the comment on DialogTitle), and Radix's
// DialogContent wires aria-labelledby on the outer role="dialog" wrapper to that title. RTL's
// getByLabelText scans every aria-labelledby element, not just form controls, so a loose
// substring regex here matches the dialog wrapper too and throws "Found multiple elements".
// The exact label text "Package" is never a substring of the title's wrapper match target
// under exact comparison, so it stays unique. Tighten here if this ever collides again — never
// reword the title to dodge it.
const pickFile = () => screen.getByLabelText('Package');

describe('ImportPackageDialog', () => {
  it('accepts only .WFcenterX files', () => {
    open();
    expect(pickFile().getAttribute('accept')).toContain('.WFcenterX');
  });

  // Catches an implementation that renders the mode choice unconditionally: a steward
  // must pick a file before there is anything to import AS, so offering the choice earlier
  // invites choosing a mode with nothing behind it.
  it('offers no import mode until a file is chosen', () => {
    open();
    expect(screen.queryByRole('button', { name: /create new work center/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /merge into existing work center/i })).not.toBeInTheDocument();
  });

  // D7: create and merge must be two separately clickable controls, never a single dropdown
  // with two options and never a checkbox — a steward who meant "create" and mis-clicks must
  // not silently land on "merge". A <select><option>create</option><option>merge</option>
  // implementation would fail this: there would be no button with either accessible name.
  it('offers create and merge as distinct choices once a file is chosen', async () => {
    open();
    await userEvent.upload(pickFile(), file('a.WFcenterX'));
    expect(screen.getByRole('button', { name: /create new work center/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /merge into existing work center/i })).toBeInTheDocument();
    // Not folded into a single combobox: a dropdown-based implementation would produce
    // exactly one control here, not two independently clickable buttons.
    expect(screen.queryByRole('combobox', { name: /mode/i })).not.toBeInTheDocument();
  });

  // "(as a new root)" is this dialog's own explicit choice (WorkCenterSelect's rootLabel prop),
  // distinct from the generic "(root)" default WorkCenterDialog's edit-mode Parent field uses —
  // this dialog describes what an IMPORT would do, not a reparent of something that exists.
  it('describes the parent picker\'s root option as creating a new root', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue(oneWorkCenter('a', 'Line A'));
    open();
    await userEvent.upload(pickFile(), file('a.WFcenterX'));
    await userEvent.click(screen.getByRole('button', { name: /create new work center/i }));
    await waitFor(() => expect(wc.workCenters.list).toHaveBeenCalled());

    await userEvent.click(screen.getByLabelText('Parent work center'));
    expect(await screen.findByRole('option', { name: '(as a new root)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '(root)' })).not.toBeInTheDocument();
  });

  it('create mode sends the chosen parent work center', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue(oneWorkCenter('a', 'Line A'));
    open();
    await userEvent.upload(pickFile(), file('a.WFcenterX'));
    await userEvent.click(screen.getByRole('button', { name: /create new work center/i }));

    await waitFor(() => expect(wc.workCenters.list).toHaveBeenCalled());
    await userEvent.click(screen.getByLabelText('Parent work center'));
    await userEvent.click(await screen.findByText('Line A'));

    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));
    expect(doImport).toHaveBeenCalledWith(expect.any(File), { mode: 'create', parentWorkCenterId: 'a' });
  });

  // Pins the default: this picker's allowRoot option starts selected (null), and an
  // implementation that instead required an explicit selection before submitting would leave
  // parentWorkCenterId undefined or block the click — either way this call would never happen
  // with a null id.
  it('create mode defaults to a new root when no parent is chosen', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue(oneWorkCenter('a', 'Line A'));
    open();
    await userEvent.upload(pickFile(), file('a.WFcenterX'));
    await userEvent.click(screen.getByRole('button', { name: /create new work center/i }));
    await waitFor(() => expect(wc.workCenters.list).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));
    expect(doImport).toHaveBeenCalledWith(expect.any(File), { mode: 'create', parentWorkCenterId: null });
  });

  it('imports in create mode and reports what was created', async () => {
    open();
    await userEvent.upload(pickFile(), file('a.WFcenterX'));
    await userEvent.click(screen.getByRole('button', { name: /create new work center/i }));
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => expect(doImport).toHaveBeenCalled());
    expect(await screen.findByText(/2 work centers/i)).toBeInTheDocument();
    expect(await screen.findByText(/3 workflows/i)).toBeInTheDocument();
  });

  // Unresolved grants are the one thing a steward must see: the import SUCCEEDED, but the
  // imported work center is not fully equivalent to the source.
  it('surfaces unresolved grants after a successful create import', async () => {
    doImport.mockResolvedValue({
      ...createReport,
      grants: { created: 0, alreadyPresent: 0, unresolved: ['Operator on Root/Gone'] },
    });
    open();
    await userEvent.upload(pickFile(), file('a.WFcenterX'));
    await userEvent.click(screen.getByRole('button', { name: /create new work center/i }));
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));
    expect(await screen.findByText(/Root\/Gone/)).toBeInTheDocument();
  });

  it('shows the server error when the create import fails', async () => {
    const { ApiError } = await import('@/lib/api/client');
    doImport.mockRejectedValue(new ApiError(409, 'conflict', 'A work center named "Line" already exists'));
    open();
    await userEvent.upload(pickFile(), file('a.WFcenterX'));
    await userEvent.click(screen.getByRole('button', { name: /create new work center/i }));
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });

  // The core merge contract: nothing applies until the steward explicitly confirms what the
  // preview showed. A wrong implementation that applies on the FIRST click (skipping preview,
  // or sending confirmed: true right away) fails the "not called with confirmed: true" check
  // below; one that never re-posts on the Merge click fails the second `toHaveBeenCalledWith`.
  it('merge previews first, showing config changes, and only applies after confirm', async () => {
    usePrincipalStore.getState().setPrincipal({
      id: 'e', email: '', loginName: 'admin', displayName: 'E', accessLevel: 'administrator',
      isAdministrator: true, rights: [], missionSystemCommanderOf: [],
    });
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue(oneWorkCenter('a', 'Line A'));
    const { ApiError } = await import('@/lib/api/client');
    doImport.mockImplementation((_file: File, opts: { mode: string; confirmed?: boolean }) => {
      if (opts.mode === 'merge' && !opts.confirmed) {
        return Promise.reject(new ApiError(409, 'conflict', 'Confirmation required', {
          error: { code: 'conflict', message: 'Confirmation required', impact: mergeReport },
        }));
      }
      return Promise.resolve(mergeReport);
    });

    open();
    await userEvent.upload(pickFile(), file('a.WFcenterX'));
    await userEvent.click(screen.getByRole('button', { name: /merge into existing work center/i }));
    await waitFor(() => expect(wc.workCenters.list).toHaveBeenCalled());
    await userEvent.click(screen.getByLabelText('Target work center'));
    await userEvent.click(await screen.findByText('Line A'));

    await userEvent.click(screen.getByRole('button', { name: /preview merge/i }));

    // The preview call happened, but never with confirmed: true.
    await waitFor(() => expect(doImport).toHaveBeenCalledTimes(1));
    expect(doImport).not.toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ confirmed: true }));

    // The config-change row from the rolled-back preview is on screen — nothing was written,
    // but the steward can see what WOULD change.
    expect(await screen.findByText(/dispatchPolicy/)).toBeInTheDocument();
    expect(screen.getByText(/least_queued_steps/)).toBeInTheDocument();
    expect(screen.getByText(/round_robin/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^merge$/i }));

    await waitFor(() => expect(doImport).toHaveBeenCalledTimes(2));
    expect(doImport).toHaveBeenCalledWith(expect.any(File), {
      mode: 'merge', targetWorkCenterId: 'a', confirmed: true,
    });
  });

  // Gating (spec §8.9): the route checks work_center:edit on the merge branch only, so a
  // principal without it must never even reach the target picker. Wrapped with RequiresTooltip
  // per this directory's convention — the wrapper span carries the `title` a disabled control
  // cannot show itself.
  it('merge is disabled without work_center:edit', async () => {
    usePrincipalStore.getState().setPrincipal({
      id: 'v', email: '', loginName: 'admin', displayName: 'V', accessLevel: 'viewer',
      isAdministrator: false, rights: ['work_center:create'], missionSystemCommanderOf: [],
    });
    open();
    await userEvent.upload(pickFile(), file('a.WFcenterX'));
    const mergeBtn = screen.getByRole('button', { name: /merge into existing work center/i });
    expect(mergeBtn).toBeDisabled();
    expect(mergeBtn.parentElement).toHaveAttribute('title', 'Requires work_center:edit');
  });
});
