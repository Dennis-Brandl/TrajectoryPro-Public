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
import { SavePackageDialog } from './SavePackageDialog';
import { ApiError } from '@/lib/api/client';

vi.mock('@/lib/api/package', () => ({
  packages: {
    preview: vi.fn(),
    downloadUrl: (id: string, scope: string) => `/api/work-centers/${id}/package?scope=${scope}`,
  },
}));
import { packages } from '@/lib/api/package';

const preview = packages.preview as unknown as ReturnType<typeof vi.fn>;

const empty = { workCenters: 1, workflows: 2, environments: 1, roles: 0, grants: 0, warnings: [] };

beforeEach(() => { preview.mockReset(); preview.mockResolvedValue(empty); });
afterEach(cleanup);

const open = () => render(
  <SavePackageDialog open onOpenChange={() => {}} workCenterId="wc-1" workCenterName="Line" />,
);

describe('SavePackageDialog', () => {
  it('previews with scope=all by default', async () => {
    open();
    await waitFor(() => expect(preview).toHaveBeenCalledWith('wc-1', 'all'));
    expect(await screen.findByText(/2 workflows/i)).toBeInTheDocument();
  });

  it('re-previews when the steward switches to effective only', async () => {
    open();
    await waitFor(() => expect(preview).toHaveBeenCalledWith('wc-1', 'all'));
    await userEvent.click(screen.getByLabelText(/effective/i));
    await waitFor(() => expect(preview).toHaveBeenCalledWith('wc-1', 'effective'));
  });

  // §7.3 — warnings are the reason the preflight exists at all. A steward must see that
  // grants will be missing BEFORE the file lands on disk.
  it('shows warnings returned by the preview', async () => {
    preview.mockResolvedValue({ ...empty, warnings: ['Role grant on an ambiguous node in "Mix"'] });
    open();
    expect(await screen.findByText(/ambiguous node/i)).toBeInTheDocument();
  });

  it('points Download at the scoped URL', async () => {
    open();
    await waitFor(() => expect(preview).toHaveBeenCalled());
    const link = await screen.findByRole('link', { name: /download/i });
    expect(link).toHaveAttribute('href', '/api/work-centers/wc-1/package?scope=all');
  });

  // Important 2 — Button's `disabled` prop lands on the rendered <a> via asChild, but
  // anchors are not form controls so `:disabled` never applies: the link stayed live and
  // navigable even after the preview failed. If the work center was deleted in another tab,
  // packages.preview 404s and the "download" would fetch a 404 JSON error body and save it
  // to disk under the `download` attribute — exactly what the preflight exists to prevent.
  it('renders no live download link when the preview request fails', async () => {
    preview.mockRejectedValue(new ApiError(404, 'not_found', 'Work center not found'));
    open();
    await screen.findByText(/work center not found/i);

    expect(screen.queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: /download/i });
    expect(button).toBeDisabled();
  });

  it('shows a live Download link once the preview resolves', async () => {
    open();
    const link = await screen.findByRole('link', { name: /download/i });
    expect(link).toHaveAttribute('href', '/api/work-centers/wc-1/package?scope=all');
  });
});

describe('SavePackageDialog warnings list', () => {
  // Minor 3 — two ambiguous grants in the SAME workflow emit byte-identical warning
  // strings; keying <li> by the raw string collides two different React children onto one
  // key. Index-keying avoids the collision (and the console warning it produces).
  it('renders duplicate warning strings without a React duplicate-key warning', async () => {
    const dup = 'Role grant on an ambiguous node in workflow "Mix" was not exported.';
    preview.mockResolvedValue({ ...empty, warnings: [dup, dup] });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    open();
    const items = await screen.findAllByText(dup);

    expect(items).toHaveLength(2);
    const keyWarning = consoleError.mock.calls.some((args) =>
      args.some((a) => typeof a === 'string' && a.includes('same key')));
    expect(keyWarning).toBe(false);
    consoleError.mockRestore();
  });
});
