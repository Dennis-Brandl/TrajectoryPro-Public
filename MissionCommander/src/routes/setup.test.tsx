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
import { isRedirect } from '@tanstack/react-router';

// A spy for the navigate function returned by useNavigate. Hoisted so the
// vi.mock factory below (itself hoisted above imports) can close over it.
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

// Partial-mock the router: keep createFileRoute/redirect/isRedirect real (so the
// route builds and beforeLoad throws a genuine redirect Response) but replace
// useNavigate with our spy. Rendering SetupPage bare would otherwise call
// useRouter() with no <RouterProvider>, which warns to stderr and pollutes output.
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/lib/auth/setupClient', () => ({ getSetupStatus: vi.fn() }));
vi.mock('@/lib/auth/auth-client', () => ({ signUp: { email: vi.fn() } }));

import { SetupPage, Route } from './setup';
import { getSetupStatus } from '@/lib/auth/setupClient';
import { signUp } from '@/lib/auth/auth-client';

const beforeLoad = Route.options.beforeLoad as unknown as () => Promise<unknown>;
async function thrownBy(fn: () => Promise<unknown>): Promise<unknown> {
  try { await fn(); return undefined; } catch (e) { return e; }
}

beforeEach(() => vi.clearAllMocks());
// This config does not enable Vitest globals, so @testing-library/react cannot
// auto-register its afterEach(cleanup). Without this, each render() leaks its DOM
// into document.body and later getByLabelText/getByRole calls match duplicates.
afterEach(cleanup);

describe('setup route beforeLoad', () => {
  // Regression guard for the plan's swallow-the-redirect bug: an already-bootstrapped
  // module must bounce away from /setup, not silently render the setup form.
  it('redirects to / when setup is already complete', async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({ setupComplete: true });
    const err = await thrownBy(beforeLoad);
    expect(isRedirect(err)).toBe(true);
    expect((err as { options: { to: string } }).options.to).toBe('/');
  });

  it('renders the first-run form (no redirect) when setup is incomplete', async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({ setupComplete: false });
    expect(await thrownBy(beforeLoad)).toBeUndefined();
  });
});

describe('SetupPage', () => {
  it('calls signUp.email with the entered fields and navigates home on success', async () => {
    vi.mocked(signUp.email).mockResolvedValue({ error: null } as never);
    render(<SetupPage />);
    await userEvent.type(screen.getByLabelText('Name'), 'Admin');
    await userEvent.type(screen.getByLabelText('Email'), 'admin@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Create administrator' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }));
    expect(signUp.email).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'password123', name: 'Admin' });
  });

  it('surfaces the server error message as an alert and does not navigate', async () => {
    vi.mocked(signUp.email).mockResolvedValue({ error: { message: 'Email already registered' } } as never);
    render(<SetupPage />);
    await userEvent.type(screen.getByLabelText('Name'), 'Admin');
    await userEvent.type(screen.getByLabelText('Email'), 'admin@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Create administrator' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email already registered');
    expect(navigate).not.toHaveBeenCalled();
  });
});
