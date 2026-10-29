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
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { usePrincipalStore } from '@/stores/principalStore';
import { useSelectionStore } from '@/stores/selectionStore';
import * as environmentsApi from '@/lib/api/environments';
import { EnvironmentTree } from './EnvironmentTree';

const es = (id: string, name: string, workCenterId: string, workCenterName: string, state = 'Effective', version = '1.0.0') =>
  ({ id, oid: `o-${id}`, name, workCenterId, workCenterName, version, state, effectiveFrom: null,
     sourceLibraryName: null, sourceLibraryOid: null });

beforeEach(() => {
  usePrincipalStore.getState().clearPrincipal();
  useSelectionStore.setState({ selectedEnvironmentId: null });
  vi.spyOn(environmentsApi.environments, 'list').mockResolvedValue({
    environments: [es('e1', 'Kitchen', 'wc2', 'Line 2'), es('e2', 'Line A', 'wc1', 'Line 1', 'Draft')],
  });
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

const steward = { id: 's', email: '', loginName: 'admin', displayName: 'S', accessLevel: 'steward', isAdministrator: false, rights: ['environment:read', 'environment:create'], missionSystemCommanderOf: [] };

describe('EnvironmentTree', () => {
  it('groups entries under work-center headers ordered by name, labelled "Name v<version>" with a state badge', async () => {
    usePrincipalStore.getState().setPrincipal(steward);
    render(<EnvironmentTree />);

    const headers = await screen.findAllByRole('heading', { level: 3 });
    expect(headers.map((h) => h.textContent)).toEqual(['Line 1', 'Line 2']);

    expect(screen.getByRole('button', { name: /Kitchen v1\.0\.0/ })).toHaveTextContent('Effective');
    expect(screen.getByRole('button', { name: /Line A v1\.0\.0/ })).toHaveTextContent('Draft');
  });

  it('keeps two work centers holding the same spec separate', async () => {
    // Same oid loaded into two work centers is two INDEPENDENT entries (spec D3).
    usePrincipalStore.getState().setPrincipal(steward);
    vi.mocked(environmentsApi.environments.list).mockResolvedValue({ environments: [
      es('a', 'Ambient', 'wc1', 'Line 1'),
      es('b', 'Ambient', 'wc2', 'Line 2', 'Draft', '2.0.0'),
    ] });
    render(<EnvironmentTree />);
    const headers = await screen.findAllByRole('heading', { level: 3 });
    expect(headers.map((h) => h.textContent)).toEqual(['Line 1', 'Line 2']);
    expect(screen.getByRole('button', { name: /Ambient v1\.0\.0/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ambient v2\.0\.0/ })).toBeInTheDocument();
  });

  it('shows two entries of the same name at different versions adjacently, ungrouped', async () => {
    // Entries are FLAT: M6 retired lineage grouping (see WorkflowTree.test.tsx).
    usePrincipalStore.getState().setPrincipal(steward);
    vi.mocked(environmentsApi.environments.list).mockResolvedValue({ environments: [
      es('a', 'Ambient', 'wc1', 'Line 1', 'Effective', '1.0.0'),
      es('b', 'Ambient', 'wc1', 'Line 1', 'Draft', '2.0.0'),
    ] });
    render(<EnvironmentTree />);

    const first = await screen.findByRole('button', { name: /Ambient v1\.0\.0/ });
    const second = screen.getByRole('button', { name: /Ambient v2\.0\.0/ });
    expect(first.parentElement).toBe(second.parentElement);
    expect(screen.queryByRole('button', { name: /\(2 versions\)/ })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
  });

  it('does not show the empty state while still loading', async () => {
    usePrincipalStore.getState().setPrincipal(steward);
    let resolve!: (v: { environments: [] }) => void;
    vi.spyOn(environmentsApi.environments, 'list').mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<EnvironmentTree />);

    expect(screen.queryByText('No environments loaded')).not.toBeInTheDocument();
    resolve({ environments: [] });
    expect(await screen.findByText('No environments loaded')).toBeInTheDocument();
  });

  it('selects an environment on click', async () => {
    usePrincipalStore.getState().setPrincipal(steward);
    render(<EnvironmentTree />);
    await userEvent.click(await screen.findByRole('button', { name: /Kitchen v1\.0\.0/ }));
    expect(useSelectionStore.getState().selectedEnvironmentId).toBe('e1');
  });

  it('has no Import or Pull control — loading happens on the work center', async () => {
    usePrincipalStore.getState().setPrincipal(steward);
    render(<EnvironmentTree />);
    await screen.findByRole('button', { name: /Kitchen v1\.0\.0/ });
    expect(screen.queryByRole('button', { name: /import/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /pull/i })).toBeNull();
  });

  it('surfaces a load failure instead of rendering an empty tree', async () => {
    usePrincipalStore.getState().setPrincipal(steward);
    vi.spyOn(environmentsApi.environments, 'list').mockRejectedValue(new Error('boom'));
    render(<EnvironmentTree />);
    expect(await screen.findByText('Failed to load environments')).toBeInTheDocument();
  });
});
