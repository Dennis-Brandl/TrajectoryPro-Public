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
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { LinkPickerModal } from './LinkPickerModal';

beforeEach(() => vi.clearAllMocks());
// This config does not enable Vitest globals, so @testing-library/react cannot
// auto-register its afterEach(cleanup). Without this, each render() leaks its DOM
// into document.body and later getByRole/getByText calls match duplicates.
afterEach(cleanup);

describe('LinkPickerModal', () => {
  it('lists unlinked items, filters by search, and links on click', async () => {
    const fetchItems = vi.fn().mockResolvedValue([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }]);
    const onLink = vi.fn().mockResolvedValue(undefined);
    render(<LinkPickerModal open onOpenChange={() => {}} title="Link workflow" fetchItems={fetchItems} linkedIds={new Set(['b'])} onLink={onLink} />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Bravo')).not.toBeInTheDocument();   // already linked → excluded
    await userEvent.type(screen.getByPlaceholderText(/search/i), 'alph');
    await userEvent.click(screen.getByRole('button', { name: /link/i }));
    await waitFor(() => expect(onLink).toHaveBeenCalledWith('a'));
  });

  // Task 11: onLink is a server round-trip; a second click on the same row while
  // the first is still in flight must not fire a second link attempt. Uses a
  // manually-resolved promise so the assertion can run WHILE the first click's
  // request is still pending, before ever resolving it.
  it('disables the Link button while onLink is pending and ignores a second click', async () => {
    const fetchItems = vi.fn().mockResolvedValue([{ id: 'a', name: 'Alpha' }]);
    let resolveLink!: () => void;
    const onLink = vi.fn(() => new Promise<void>((resolve) => { resolveLink = resolve; }));
    render(<LinkPickerModal open onOpenChange={() => {}} title="Link workflow" fetchItems={fetchItems} linkedIds={new Set()} onLink={onLink} />);
    const linkButton = await screen.findByRole('button', { name: /link/i });
    await userEvent.click(linkButton);
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(linkButton).toBeDisabled();
    await userEvent.click(linkButton); // ignored — a link is already in flight
    expect(onLink).toHaveBeenCalledTimes(1);
    await act(async () => resolveLink());
    await waitFor(() => expect(linkButton).not.toBeDisabled()); // guard clears in `finally`
  });

  it('shows a distinct failed state when fetchItems rejects, cleared on the next open', async () => {
    const fetchItems = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue([{ id: 'a', name: 'Alpha' }]);
    const onLink = vi.fn();
    const { rerender } = render(<LinkPickerModal open onOpenChange={() => {}} title="Link workflow" fetchItems={fetchItems} linkedIds={new Set()} onLink={onLink} />);
    expect(await screen.findByText('Failed to load items')).toBeInTheDocument();
    expect(screen.queryByText('No items found')).not.toBeInTheDocument();
    // Reopen (close then open again): the failed flag must not latch across opens.
    rerender(<LinkPickerModal open={false} onOpenChange={() => {}} title="Link workflow" fetchItems={fetchItems} linkedIds={new Set()} onLink={onLink} />);
    rerender(<LinkPickerModal open onOpenChange={() => {}} title="Link workflow" fetchItems={fetchItems} linkedIds={new Set()} onLink={onLink} />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load items')).not.toBeInTheDocument();
  });

  // Multi mode (2026-08-10 user-testing ticket): onLinkMany switches rows to checkboxes with
  // one footer action carrying a live count. Single mode above is untouched.
  it('multi mode: checking items enables the footer action with a count and submits the checked ids', async () => {
    const fetchItems = vi.fn().mockResolvedValue([
      { id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }, { id: 'c', name: 'Charlie' },
    ]);
    const onLinkMany = vi.fn().mockResolvedValue(undefined);
    render(<LinkPickerModal open onOpenChange={() => {}} title="Assign roles" actionLabel="Assign roles"
      fetchItems={fetchItems} linkedIds={new Set(['c'])} onLinkMany={onLinkMany} />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Charlie')).not.toBeInTheDocument(); // already linked → excluded
    expect(screen.getByRole('button', { name: 'Assign roles' })).toBeDisabled(); // nothing checked
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bravo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Assign roles (2)' }));
    await waitFor(() => expect(onLinkMany).toHaveBeenCalledWith(['a', 'b']));
  });

  it('multi mode: a checked item that becomes linked mid-open is dropped from the count and the submission', async () => {
    const fetchItems = vi.fn().mockResolvedValue([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }]);
    const onLinkMany = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<LinkPickerModal open onOpenChange={() => {}} title="t" actionLabel="Assign roles"
      fetchItems={fetchItems} linkedIds={new Set()} onLinkMany={onLinkMany} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Alpha' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bravo' }));
    expect(screen.getByRole('button', { name: 'Assign roles (2)' })).toBeInTheDocument();
    // A partial multi-submit refreshes the caller's view: Alpha is now linked.
    rerender(<LinkPickerModal open onOpenChange={() => {}} title="t" actionLabel="Assign roles"
      fetchItems={fetchItems} linkedIds={new Set(['a'])} onLinkMany={onLinkMany} />);
    await userEvent.click(screen.getByRole('button', { name: 'Assign roles (1)' }));
    await waitFor(() => expect(onLinkMany).toHaveBeenCalledWith(['b']));
  });

  // Fencing: reopening (or closing) before an earlier fetch settles must not let the stale
  // response repopulate the list. The reqId guard drops the superseded fetch.
  it('drops a superseded fetch when reopened mid-flight', async () => {
    let resolveFirst!: (v: { id: string; name: string }[]) => void;
    const fetchItems = vi.fn()
      .mockReturnValueOnce(new Promise<{ id: string; name: string }[]>((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce([{ id: 'b', name: 'Beta' }]);
    const onLink = vi.fn(async () => {});
    const { rerender } = render(
      <LinkPickerModal open onOpenChange={() => {}} title="t" fetchItems={fetchItems} linkedIds={new Set()} onLink={onLink} />,
    );
    rerender(<LinkPickerModal open={false} onOpenChange={() => {}} title="t" fetchItems={fetchItems} linkedIds={new Set()} onLink={onLink} />);
    rerender(<LinkPickerModal open onOpenChange={() => {}} title="t" fetchItems={fetchItems} linkedIds={new Set()} onLink={onLink} />);
    expect(await screen.findByText('Beta')).toBeInTheDocument(); // second (current) fetch
    await act(async () => resolveFirst([{ id: 'a', name: 'Alpha-STALE' }])); // first — must be dropped
    expect(screen.queryByText('Alpha-STALE')).toBeNull();
  });
});
