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
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSelectionStore } from '@/stores/selectionStore';
import { usePrincipalStore } from '@/stores/principalStore';
import * as wc from '@/lib/api/work-centers';
import * as packageApi from '@/lib/api/package';
import type { ImportReport } from '@/lib/api/types';
// The tree owns the import dialog and must poke the (separately mounted) detail pane after a
// successful import, mirroring WorkCenterDetail's own module-level refreshTree() handler. This
// test only cares that the wiring calls it, not that WorkCenterDetail itself re-renders, so the
// whole module is replaced — it is never mounted here.
vi.mock('@/components/work-center/WorkCenterDetail', () => ({ refreshDetail: vi.fn() }));
import { refreshDetail } from '@/components/work-center/WorkCenterDetail';
import { WorkCenterTree } from './WorkCenterTree';

// This config does not enable Vitest globals, so @testing-library/react cannot
// auto-register its afterEach(cleanup). Without this, each render() leaks its DOM
// into document.body and later getByRole/getByText calls match duplicates.
afterEach(cleanup);
// vi.spyOn returns the SAME mock instance when re-spying an already-spied method,
// so call counts would accumulate across tests without a restore — breaking the
// exactly-once assertion on workCenters.get below.
afterEach(() => vi.restoreAllMocks());

beforeEach(() => useSelectionStore.setState({ selectedWorkCenterId: null }));
afterEach(() => usePrincipalStore.getState().clearPrincipal());

const emptyReport: ImportReport = {
  rootWorkCenterId: 'r',
  workCenters: { matched: 0, created: 1 },
  workflows: { created: 0, alreadyPresent: 0 },
  environments: { created: 0, alreadyPresent: 0 },
  links: { created: 0, alreadyPresent: 0 },
  roles: { created: 0 },
  grants: { created: 0, alreadyPresent: 0, unresolved: [] },
  configChanges: [],
  targetOnlyGrants: [],
  warnings: [],
};

describe('WorkCenterTree', () => {
  it('renders nested work centers and selects on click', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({ nodes: [
      { id: 'r', name: 'Root', parentWorkCenterId: null, depth: 0, typeName: null },
      { id: 'c', name: 'Child', parentWorkCenterId: 'r', depth: 1, typeName: null },
    ] });
    render(<WorkCenterTree onCreateRoot={() => {}} onCreateChild={() => {}} />);
    expect(await screen.findByText('Root')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Child'));
    expect(useSelectionStore.getState().selectedWorkCenterId).toBe('c');
  });

  it('collapses and re-expands a subtree via the chevron', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({ nodes: [
      { id: 'r', name: 'Root', parentWorkCenterId: null, depth: 0, typeName: null },
      { id: 'c', name: 'Child', parentWorkCenterId: 'r', depth: 1, typeName: null },
    ] });
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({ workflows: [] } as never);
    render(<WorkCenterTree onCreateRoot={() => {}} onCreateChild={() => {}} />);
    // Seeded fully expanded on load: the nested child is visible without any clicks.
    expect(await screen.findByText('Child')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Root' }));
    expect(screen.queryByText('Child')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Expand Root' }));
    expect(await screen.findByText('Child')).toBeInTheDocument();
  });

  it('shows work center and workflow types after the name; aria-labels keep the bare name', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({ nodes: [
      { id: 'r', name: 'Line 1', parentWorkCenterId: null, depth: 0, typeName: 'Production Line' },
    ] });
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({
      workflows: [{ id: 'wf1', oid: 'o1', name: 'Clean Tank', version: '1', state: 'released', typeName: 'Operation', effectiveFrom: null }],
    } as never);
    const { container } = render(<WorkCenterTree onCreateRoot={() => {}} onCreateChild={() => {}} />);
    expect(await screen.findByText(/Line 1/)).toBeInTheDocument();
    expect(container.textContent).toContain('Line 1 · Production Line');
    expect(screen.getByRole('button', { name: 'New child of Line 1' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Line 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand Line 1' }));
    await waitFor(() => expect(container.textContent).toContain('Clean Tank · Operation'));
  });

  it('re-expanding lazily fetches workflows exactly once and renders them as italic leaves', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({ nodes: [
      { id: 'r', name: 'Root', parentWorkCenterId: null, depth: 0, typeName: null },
    ] });
    const getSpy = vi.spyOn(wc.workCenters, 'get').mockResolvedValue({
      workflows: [{ id: 'wf1', oid: 'o1', name: 'Deploy Flow', version: '1', state: 'released', libraryId: 'lib1', libraryName: 'Default', effectiveFrom: null }],
    } as never);
    render(<WorkCenterTree onCreateRoot={() => {}} onCreateChild={() => {}} />);
    expect(await screen.findByText('Root')).toBeInTheDocument();
    expect(getSpy).not.toHaveBeenCalled(); // seeding the expanded set never fetches
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Root' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand Root' }));
    const leaf = await screen.findByText('Deploy Flow');
    expect(leaf).toHaveClass('italic');
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith('r');
  });

  it('exposes aria-expanded on the row and wraps revealed children in role="group"', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({ nodes: [
      { id: 'r', name: 'Root', parentWorkCenterId: null, depth: 0, typeName: null },
      { id: 'c', name: 'Child', parentWorkCenterId: 'r', depth: 1, typeName: null },
    ] });
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({ workflows: [] } as never);
    render(<WorkCenterTree onCreateRoot={() => {}} onCreateChild={() => {}} />);
    const rootRow = () => screen.getByText('Root').closest('[role="treeitem"]') as HTMLElement;

    // Seeded fully expanded on load (see the test above), so collapse Root first to
    // observe the false state before re-expanding it.
    expect(await screen.findByText('Child')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Root' }));
    expect(rootRow()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.queryByText('Child')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Expand Root' }));
    expect(await screen.findByText('Child')).toBeInTheDocument();
    expect(rootRow()).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group');
    expect(within(group).getByText('Child')).toBeInTheDocument();
  });

  it('a childless node with confirmed-empty workflows has no aria-expanded', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({ nodes: [
      { id: 'r', name: 'Root', parentWorkCenterId: null, depth: 0, typeName: null },
      { id: 'c', name: 'Child', parentWorkCenterId: 'r', depth: 1, typeName: null },
    ] });
    vi.spyOn(wc.workCenters, 'get').mockResolvedValue({ workflows: [] } as never);
    render(<WorkCenterTree onCreateRoot={() => {}} onCreateChild={() => {}} />);
    expect(await screen.findByText('Child')).toBeInTheDocument();

    // Child is seeded expanded with its workflows not yet fetched (cachedWorkflows
    // === undefined), so it still shows a chevron even though it has no children of
    // its own — canExpand treats "not yet checked" as expandable. Collapsing and
    // re-expanding forces the lazy fetch, which here resolves empty, flipping
    // canExpand to false and dropping the chevron entirely (the "drop the dead
    // toggle" case documented on TreeRow's canExpand).
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Child' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand Child' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^(Collapse|Expand) Child$/ })).not.toBeInTheDocument();
    });

    const childRow = screen.getByText('Child').closest('[role="treeitem"]');
    expect(childRow).not.toHaveAttribute('aria-expanded');
  });

  // Regression: a confirmed import (create or merge) must refresh BOTH panes. Before this fix,
  // onImported only called refreshTree() — the detail pane behind the dialog kept showing stale
  // data indefinitely, and for a config-only merge the tree doesn't visibly change either, so
  // the app looked like nothing happened.
  it('refreshes the detail pane, not just the tree, after a successful package import', async () => {
    usePrincipalStore.getState().setPrincipal({
      id: 'a', email: '', loginName: 'admin', displayName: 'Admin', accessLevel: 'administrator',
      isAdministrator: true, rights: [], missionSystemCommanderOf: [],
    });
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({ nodes: [
      { id: 'r', name: 'Root', parentWorkCenterId: null, depth: 0, typeName: null },
    ] });
    vi.spyOn(packageApi.packages, 'import').mockResolvedValue(emptyReport);

    render(<WorkCenterTree onCreateRoot={() => {}} onCreateChild={() => {}} />);
    expect(await screen.findByText('Root')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Import package' }));
    await userEvent.upload(
      screen.getByLabelText('Package'),
      new File([new Uint8Array([1, 2, 3])], 'a.WFcenterX'),
    );
    await userEvent.click(screen.getByRole('button', { name: /create new work center/i }));
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => expect(refreshDetail).toHaveBeenCalled());
  });
  describe('first-run empty state', () => {
    const setAdmin = () => usePrincipalStore.getState().setPrincipal({
      id: 'a', email: '', loginName: 'admin', displayName: 'Admin', accessLevel: 'administrator',
      isAdministrator: true, rights: [], missionSystemCommanderOf: [],
    });

    it('empty tree with create right shows the first-run prompt', async () => {
      setAdmin();
      vi.spyOn(wc.workCenters, 'list').mockResolvedValue({ nodes: [] });
      const onCreateRoot = vi.fn();
      render(<WorkCenterTree onCreateRoot={onCreateRoot} onCreateChild={() => {}} />);
      expect(await screen.findByText('No work centers yet.')).toBeInTheDocument();
      await userEvent.click(screen.getByText('Create work center'));
      expect(onCreateRoot).toHaveBeenCalledTimes(1);
      await userEvent.click(screen.getByText('Import package'));
      expect(await screen.findByText('Import a work-center package')).toBeInTheDocument();
    });

    it('empty tree without create right says to ask an administrator', async () => {
      vi.spyOn(wc.workCenters, 'list').mockResolvedValue({ nodes: [] });
      render(<WorkCenterTree onCreateRoot={() => {}} onCreateChild={() => {}} />);
      expect(await screen.findByText('No work centers yet. Ask an administrator to create one or to give you access.')).toBeInTheDocument();
      expect(screen.queryByText('Create work center')).not.toBeInTheDocument();
    });

    it('nothing shows while the tree is loading', async () => {
      setAdmin();
      vi.spyOn(wc.workCenters, 'list').mockReturnValue(new Promise(() => {}));
      render(<WorkCenterTree onCreateRoot={() => {}} onCreateChild={() => {}} />);
      await Promise.resolve();
      expect(screen.queryByText(/No work centers yet/)).not.toBeInTheDocument();
    });

    it('load error shows only the error', async () => {
      setAdmin();
      vi.spyOn(wc.workCenters, 'list').mockRejectedValue(new Error('boom'));
      render(<WorkCenterTree onCreateRoot={() => {}} onCreateChild={() => {}} />);
      await waitFor(() => expect(document.querySelector('.text-destructive')).not.toBeNull());
      expect(screen.queryByText(/No work centers yet/)).not.toBeInTheDocument();
    });
  });
});
