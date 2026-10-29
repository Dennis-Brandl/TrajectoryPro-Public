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
// useNavigate with our spy. Rendering LoginPage bare would otherwise call
// useRouter() with no <RouterProvider>, which warns to stderr and pollutes output.
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/lib/auth/auth-client', () => ({ signIn: { email: vi.fn() }, useSession: vi.fn() }));
vi.mock('@/lib/auth/setupClient', () => ({ getSetupStatus: vi.fn() }));

import { LoginPage, Route } from './login';
import { signIn, useSession } from '@/lib/auth/auth-client';
import { getSetupStatus } from '@/lib/auth/setupClient';

const beforeLoad = Route.options.beforeLoad as unknown as () => Promise<unknown>;
async function thrownBy(fn: () => Promise<unknown>): Promise<unknown> {
  try { await fn(); return undefined; } catch (e) { return e; }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSession).mockReturnValue({ data: null, isPending: false } as never);
});
// This config does not enable Vitest globals, so @testing-library/react cannot
// auto-register its afterEach(cleanup). Without this, each render() leaks its DOM
// into document.body and later getByLabelText/getByRole calls match duplicates.
afterEach(cleanup);

describe('LoginPage', () => {
  it('shows the zod inline error for a bad email and never calls signIn', async () => {
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('Invalid email')).toBeInTheDocument();
    expect(signIn.email).not.toHaveBeenCalled();
  });

  it('calls signIn.email with the entered credentials and navigates home on success', async () => {
    vi.mocked(signIn.email).mockResolvedValue({ error: null } as never);
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText('Email'), 'admin@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/' }));
    expect(signIn.email).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'password123' });
  });

  it('surfaces the server error message in the login-error slot and does not navigate', async () => {
    vi.mocked(signIn.email).mockResolvedValue({ error: { message: 'Invalid credentials' } } as never);
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText('Email'), 'admin@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByTestId('login-error')).toHaveTextContent('Invalid credentials');
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('login route beforeLoad', () => {
  // Regression guard for the plan's swallow-the-redirect bug: the redirect must
  // propagate out of beforeLoad, not be eaten by the setup-status try/catch.
  it('redirects to /setup when the server reports setup is incomplete', async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({ setupComplete: false });
    const err = await thrownBy(beforeLoad);
    expect(isRedirect(err)).toBe(true);
    expect((err as { options: { to: string } }).options.to).toBe('/setup');
  });

  it('renders the page (no redirect) when the setup-status call fails', async () => {
    vi.mocked(getSetupStatus).mockRejectedValue(new Error('network down'));
    expect(await thrownBy(beforeLoad)).toBeUndefined();
  });
});
