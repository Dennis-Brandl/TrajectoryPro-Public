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
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoadResultsDialog } from './LoadResultsDialog';
import type { LoadResult } from '@/lib/api/types';

afterEach(cleanup);

const wcNames = { 'wc-1': 'Line 1', 'wc-2': 'Line 2' };

const loaded: LoadResult = {
  filename: 'bottle.WFmasterX', workCenterId: 'wc-1', kind: 'workflow', status: 'loaded',
  name: 'Bottle Fill', version: '1.0.0', state: 'Draft',
  nodeCount: 2, uiStepCount: 3, envCount: 1, rolesCarried: 2, unmatchedPaths: [],
};
const failed: LoadResult = {
  filename: 'bad.WFmasterX', workCenterId: 'wc-1', kind: 'workflow', status: 'failed',
  message: 'Not a valid package',
};

const show = (results: LoadResult[]) =>
  render(<LoadResultsDialog results={results} workCenterNames={wcNames} onClose={() => {}} />);

describe('LoadResultsDialog', () => {
  it('renders one row per (file × work center) pair with its status', () => {
    show([loaded, failed]);
    expect(screen.getByText('Load results')).toBeInTheDocument();
    expect(screen.getByText('Bottle Fill')).toBeInTheDocument();
    expect(screen.getByText(/not a valid package/i)).toBeInTheDocument();
    expect(screen.getAllByText('bottle.WFmasterX')).toHaveLength(1);
  });

  it('names the target work center on each row, so a fan-out is legible', () => {
    show([loaded, { ...loaded, workCenterId: 'wc-2', status: 'already_present' }]);
    expect(screen.getByText('Line 1')).toBeInTheDocument();
    expect(screen.getByText('Line 2')).toBeInTheDocument();
    // Exact match: the summary line also contains the phrase ("1 already present"), so a
    // loose regex would match two nodes and prove nothing about the per-row pill.
    expect(screen.getByText('already present')).toBeInTheDocument();
  });

  it('decodes escaped node paths for display', () => {
    // spec §6.3/§14: node paths are percent-escaped ('%'→%25 BEFORE '/'→%2F) so a node
    // literally named 'Fill/Cap' cannot collide with a Fill→Cap nesting. The escaping is
    // invisible for every ordinary name, so ONLY a name containing / or % reveals a missing
    // decode — which is exactly why this is easy to ship broken.
    show([{ ...loaded, unmatchedPaths: ['Root%2FFill%2FCap', 'Root/Plain'] }]);
    expect(screen.getByText(/Root\/Fill\/Cap/)).toBeInTheDocument();
    expect(screen.queryByText(/%2F/)).toBeNull();
  });

  it('reports carried-over roles for a workflow', () => {
    show([loaded]);
    expect(screen.getByText(/2 roles carried/i)).toBeInTheDocument();
  });

  it('lists the roles a load created for e-signature blocks, and nothing when none were', () => {
    show([{ ...loaded, rolesCreated: ['Time Sheet Approver', 'Line Lead'] }]);
    expect(screen.getByText('Roles created for e-signatures: Time Sheet Approver, Line Lead')).toBeInTheDocument();
    cleanup();
    show([{ ...loaded, rolesCreated: [] }]);
    expect(screen.queryByText(/Roles created/)).toBeNull();
  });

  it('lists each spec of an environment package', () => {
    show([{
      filename: 'line.WFenvirX', workCenterId: 'wc-1', kind: 'environment', status: 'loaded',
      specs: [
        { id: 'a', name: 'Ambient', version: '1.0.0', state: 'Draft', status: 'loaded' },
        { id: 'b', name: 'Chilled', version: '1.0.0', state: 'Draft', status: 'already_present' },
      ],
    }]);
    expect(screen.getByText('Ambient')).toBeInTheDocument();
    expect(screen.getByText('Chilled')).toBeInTheDocument();
  });

  it('summarises the batch', () => {
    show([loaded, { ...loaded, workCenterId: 'wc-2', status: 'already_present' }, failed]);
    expect(screen.getByText(/1 loaded, 0 replaced, 1 already present, 1 failed/i)).toBeInTheDocument();
  });

  it('is closed when there are no results', () => {
    render(<LoadResultsDialog results={null} workCenterNames={wcNames} onClose={() => {}} />);
    expect(screen.queryByText('Load results')).toBeNull();
  });

  it('closes on Done', async () => {
    let closed = false;
    render(<LoadResultsDialog results={[loaded]} workCenterNames={wcNames} onClose={() => { closed = true; }} />);
    await userEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(closed).toBe(true);
  });

  it('renders load warnings for a result that carries them', () => {
    show([{
      filename: 'Line1.WFenvirX', workCenterId: 'wc-1', kind: 'environment', status: 'loaded',
      specs: [{ id: 'e1', name: 'DemoLine', version: '1.0.0', state: 'Effective', status: 'loaded' }],
      warnings: ['Resource "Printer" is declared differently by "EnvB" v1.0.0 Effective than by the existing definition (v1.0.0 Draft).'],
    }]);
    expect(screen.getByText(/Printer/)).toBeInTheDocument();
    expect(screen.getByText(/1 warning/i)).toBeInTheDocument();
  });

  it('renders no warning block when a result carries none', () => {
    show([loaded]);
    expect(screen.queryByText(/warning/i)).not.toBeInTheDocument();
  });

  it('a replaced result shows a "replaced" pill and the summary counts it', () => {
    show([{ ...loaded, status: 'replaced' }]);
    expect(screen.getByText('replaced')).toBeInTheDocument();
    expect(screen.getByText(/1 result — 0 loaded, 1 replaced, 0 already present, 0 failed/)).toBeInTheDocument();
  });

  it('a replaced environment lists the workflows that picked it up', () => {
    show([{
      filename: 'e.WFenvirX', workCenterId: 'wc-1', kind: 'environment', status: 'replaced',
      specs: [{ id: 's1', name: 'Env', version: '1.0.0', state: 'Draft', status: 'replaced' }],
      updatedWorkflows: ['A', 'B'],
    }]);
    expect(screen.getByText('Updated workflows: A, B')).toBeInTheDocument();
  });

  it('a replaced workflow reports removed and retained steps', () => {
    show([{ ...loaded, status: 'replaced', nodesRemoved: 1, grantsDropped: 2, nodesRetained: 1 }]);
    expect(screen.getByText(/1 removed \(2 role grants dropped\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 kept until running runtimes finish/)).toBeInTheDocument();
  });

  it('an already_present result shows its message', () => {
    show([{ ...loaded, status: 'already_present', message: 'No changes since the last load.' }]);
    expect(screen.getByText('No changes since the last load.')).toBeInTheDocument();
  });
});
