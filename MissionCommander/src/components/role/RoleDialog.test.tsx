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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as rolesApi from '@/lib/api/roles';
import { RoleDialog } from './RoleDialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

const CREATED = { role: { id: 'r9', name: 'Inspector', description: 'qc' }, users: [], workflows: [] };

describe('RoleDialog', () => {
  it('creates a role from name + description', async () => {
    const spy = vi.spyOn(rolesApi.roles, 'create').mockResolvedValue(CREATED as never);
    const onSaved = vi.fn();
    render(<RoleDialog open onOpenChange={() => {}} initial={null} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Inspector');
    await userEvent.type(screen.getByLabelText('Description'), 'qc');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ name: 'Inspector', description: 'qc' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(CREATED));
  });

  it('edits an existing role via update', async () => {
    const spy = vi.spyOn(rolesApi.roles, 'update').mockResolvedValue(CREATED as never);
    render(<RoleDialog open onOpenChange={() => {}} initial={{ id: 'r9', name: 'Old', description: null }} onSaved={() => {}} />);
    const name = screen.getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Inspector');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('r9', { name: 'Inspector', description: null }));
  });
});
