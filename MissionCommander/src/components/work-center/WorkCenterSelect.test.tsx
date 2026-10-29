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
import * as wc from '@/lib/api/work-centers';
import { WorkCenterSelect } from './WorkCenterSelect';

beforeEach(() => vi.clearAllMocks());
// This config does not enable Vitest globals, so @testing-library/react cannot
// auto-register its afterEach(cleanup). Without this, each render() leaks its DOM
// into document.body and later getByRole/getByText calls match duplicates.
afterEach(cleanup);

describe('WorkCenterSelect', () => {
  it('lists work centers and reports the chosen id', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({
      nodes: [
        { id: 'a', name: 'Line A', parentWorkCenterId: null, depth: 0, typeName: null },
        { id: 'b', name: 'Line B', parentWorkCenterId: null, depth: 0, typeName: null },
      ],
    } as never);
    const onChange = vi.fn();
    render(<WorkCenterSelect id="t" label="Target work center" value={null} onChange={onChange} />);

    await waitFor(() => expect(wc.workCenters.list).toHaveBeenCalled());
    await userEvent.click(screen.getByLabelText('Target work center'));
    await userEvent.click(await screen.findByText('Line B'));

    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('omits the root option unless allowRoot is set', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({
      nodes: [{ id: 'a', name: 'Line A', parentWorkCenterId: null, depth: 0, typeName: null }],
    } as never);
    render(<WorkCenterSelect id="t" label="Target work center" value={null} onChange={vi.fn()} />);

    await waitFor(() => expect(wc.workCenters.list).toHaveBeenCalled());
    await userEvent.click(screen.getByLabelText('Target work center'));
    expect(await screen.findByText('Line A')).toBeInTheDocument();
    expect(screen.queryByText('(as a new root)')).not.toBeInTheDocument();
  });

  // "(root)" is the default wording — right for WorkCenterDialog's edit-mode Parent field,
  // which reparents an EXISTING work center. A caller describing something else entirely (an
  // import that WOULD create a new root) opts into different wording via rootLabel, below.
  it('offers a root option and reports null when chosen, with allowRoot', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({
      nodes: [{ id: 'a', name: 'Line A', parentWorkCenterId: null, depth: 0, typeName: null }],
    } as never);
    const onChange = vi.fn();
    render(<WorkCenterSelect id="t" label="Parent" value="a" onChange={onChange} allowRoot />);

    await waitFor(() => expect(wc.workCenters.list).toHaveBeenCalled());
    await userEvent.click(screen.getByLabelText('Parent'));
    await userEvent.click(await screen.findByText('(root)'));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  // rootLabel exists so a caller whose root option means something other than "reparent to
  // the top" (ImportPackageDialog's create-mode picker: "the package becomes a new root") can
  // say so, without changing the default every other caller relies on.
  it('uses a caller-supplied rootLabel instead of the default, when given', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({
      nodes: [{ id: 'a', name: 'Line A', parentWorkCenterId: null, depth: 0, typeName: null }],
    } as never);
    render(<WorkCenterSelect id="t" label="Parent" value={null} onChange={vi.fn()}
      allowRoot rootLabel="(as a new root)" />);

    await waitFor(() => expect(wc.workCenters.list).toHaveBeenCalled());
    await userEvent.click(screen.getByLabelText('Parent'));
    // Role-scoped, not findByText: value={null} selects ROOT_VALUE by default, so the trigger's
    // own SelectValue ALSO renders rootLabel's text, alongside the option itself.
    expect(await screen.findByRole('option', { name: '(as a new root)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '(root)' })).not.toBeInTheDocument();
  });

  // Regression coverage for the fix-round-1 defect: `label` (visible caption) and
  // `ariaLabel` (accessible name) must be able to differ. `getByLabelText` matches
  // EITHER a <label for> association OR an aria-label, so it can't distinguish the
  // two — this uses getByRole's `name` option, which computes the accessible name
  // per the ARIA spec (aria-label wins over a same-id <label for>), the same
  // algorithm a screen reader uses.
  it('renders a visible label distinct from its accessible name when ariaLabel is given', async () => {
    vi.spyOn(wc.workCenters, 'list').mockResolvedValue({
      nodes: [{ id: 'a', name: 'Line A', parentWorkCenterId: null, depth: 0, typeName: null }],
    } as never);
    const { container } = render(
      <WorkCenterSelect id="t" label="Parent" ariaLabel="Parent work center" value={null} onChange={vi.fn()} />,
    );

    // The visible <label> element's text content is exactly "Parent" ...
    expect(container.querySelector('label')).toHaveTextContent('Parent');
    // ... while the control's computed accessible name (aria-label wins per the
    // AccName spec) is the longer, distinct string.
    expect(screen.getByRole('combobox', { name: 'Parent work center' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Parent' })).not.toBeInTheDocument();
  });
});
