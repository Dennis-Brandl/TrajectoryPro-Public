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
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('~/lib/auth-client', () => ({ signIn: { email: vi.fn() }, useSession: vi.fn() }));
vi.mock('@/lib/auth/setupClient', () => ({ getSetupStatus: vi.fn() }));

import { LoginPage } from './login';
import { useSession } from '~/lib/auth-client';
import { getSetupStatus } from '@/lib/auth/setupClient';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSession).mockReturnValue({ data: null, isPending: false } as never);
  vi.mocked(getSetupStatus).mockResolvedValue({ setupComplete: true });
});
afterEach(cleanup);

describe('LoginPage', () => {
  it('renders Sign in with the XO splash', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByAltText('Mission XO')).toBeInTheDocument();
    expect(screen.getByText(/Runs the day's workflows in a work center/)).toBeInTheDocument();
  });

  it('says setup is not finished instead of redirecting', async () => {
    vi.mocked(getSetupStatus).mockResolvedValue({ setupComplete: false });
    render(<LoginPage />);
    expect(await screen.findByText('Mission Control is not set up yet. Finish setup in Mission Commander.')).toBeInTheDocument();
  });
});
