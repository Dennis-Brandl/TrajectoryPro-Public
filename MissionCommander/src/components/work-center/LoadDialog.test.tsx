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
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoadDialog } from './LoadDialog';
import * as loadApi from '@/lib/api/load';
import * as wcApi from '@/lib/api/work-centers';

const onLoaded = vi.fn();
const props = () => ({
  open: true, onOpenChange: () => {}, workCenterId: 'wc-1',
  workCenterName: 'Line 1', onLoaded,
});

beforeEach(() => {
  onLoaded.mockReset();
  vi.spyOn(wcApi.workCenters, 'list').mockResolvedValue({
    nodes: [
      { id: 'wc-1', name: 'Line 1', parentWorkCenterId: null, depth: 0, typeName: null },
      { id: 'wc-2', name: 'Line 2', parentWorkCenterId: null, depth: 0, typeName: null },
    ],
  });
});
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

const pick = () => screen.getByLabelText('Packages') as HTMLInputElement;
const file = (name: string) => new File([new Uint8Array([1])], name);

describe('LoadDialog', () => {
  it('accepts both package extensions in one picker', () => {
    render(<LoadDialog {...props()} />);
    // One action mixes both kinds — the server routes by extension, so the picker must not
    // force the steward to choose a type up front.
    expect(pick().accept).toContain('.WFmasterX');
    expect(pick().accept).toContain('.WFenvirX');
    expect(pick().multiple).toBe(true);
  });

  it('excludes the current work center from the extra-target list', async () => {
    render(<LoadDialog {...props()} />);
    await waitFor(() => expect(wcApi.workCenters.list).toHaveBeenCalled());
    // It is already the route's target; offering it invites a confusing duplicate tick.
    expect(await screen.findByLabelText('Line 2')).toBeInTheDocument();
    expect(screen.queryByLabelText('Line 1')).toBeNull();
  });

  it('loads the picked files into the current work center plus every ticked extra', async () => {
    const spy = vi.spyOn(loadApi.load, 'load').mockResolvedValue({ results: [] });
    render(<LoadDialog {...props()} />);
    await waitFor(() => expect(wcApi.workCenters.list).toHaveBeenCalled());

    const f = file('bottle.WFmasterX');
    await userEvent.upload(pick(), f);
    await userEvent.click(await screen.findByLabelText('Line 2'));
    await userEvent.click(screen.getByRole('button', { name: /^load$/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('wc-1', [f], ['wc-2']));
    // The name map rides along so the results dialog can label every fan-out row —
    // it would otherwise have only uuids for the extra targets.
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith([], { 'wc-1': 'Line 1', 'wc-2': 'Line 2' }));
  });

  it('disables Load until at least one file is picked', async () => {
    render(<LoadDialog {...props()} />);
    expect(screen.getByRole('button', { name: /^load$/i })).toBeDisabled();
    await userEvent.upload(pick(), file('bottle.WFmasterX'));
    expect(screen.getByRole('button', { name: /^load$/i })).toBeEnabled();
  });

  it('surfaces a failed request without closing or reporting results', async () => {
    vi.spyOn(loadApi.load, 'load').mockRejectedValue(new Error('boom'));
    render(<LoadDialog {...props()} />);
    await userEvent.upload(pick(), file('bottle.WFmasterX'));
    await userEvent.click(screen.getByRole('button', { name: /^load$/i }));

    // The steward's file selection is expensive to redo, so the dialog stays open.
    await waitFor(() => expect(screen.getByRole('button', { name: /^load$/i })).toBeEnabled());
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('still loads into the route work center when the target list cannot be fetched', async () => {
    vi.spyOn(wcApi.workCenters, 'list').mockRejectedValue(new Error('offline'));
    const spy = vi.spyOn(loadApi.load, 'load').mockResolvedValue({ results: [] });
    render(<LoadDialog {...props()} />);

    const f = file('bottle.WFmasterX');
    await userEvent.upload(pick(), f);
    await userEvent.click(screen.getByRole('button', { name: /^load$/i }));
    // Losing the fan-out list must not block the primary action.
    await waitFor(() => expect(spy).toHaveBeenCalledWith('wc-1', [f], []));
  });
});
