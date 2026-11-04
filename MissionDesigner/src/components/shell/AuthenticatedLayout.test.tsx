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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const navigate = vi.fn()
let pathname = '/'
const ctx: { user: Record<string, unknown>; bootError: null } = { user: { name: 'Ada' }, bootError: null }

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: object) => ({ ...opts, useRouteContext: () => ctx }),
  Outlet: () => <div data-testid="outlet" />,
  redirect: vi.fn(),
  useNavigate: () => navigate,
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) => select({ location: { pathname } }),
}))
vi.mock('@/lib/auth-client', () => ({ authClient: {}, signOut: vi.fn() }))
vi.mock('@/stores/specificationStore/saveScheduler', () => ({
  flushNow: vi.fn().mockResolvedValue(undefined),
  installNavigationGuard: () => () => {},
}))
vi.mock('@/stores/specificationStore/libraryCrud', () => ({
  flushLibrariesNow: vi.fn().mockResolvedValue(undefined),
  discardLibraryEdits: vi.fn(),
}))
vi.mock('@/stores/specificationStore/bootSequence', () => ({ runBoot: vi.fn() }))

import { AuthenticatedLayout } from '@/routes/_authenticated'
import { useSpecificationStore } from '@/stores/specificationStore'
import { useWorkflowSessionStore } from '@/stores/workflowSessionStore'

beforeEach(() => {
  vi.stubGlobal('__APP_VERSION__', '9.9.9')
  navigate.mockReset()
  pathname = '/'
  ctx.user = { name: 'Ada' }
  useSpecificationStore.getState()._reset()
  useWorkflowSessionStore.getState().clearSession()
})

describe('AuthenticatedLayout header', () => {
  it('the icon opens About with the app name, build and tagline', () => {
    render(<AuthenticatedLayout />)
    fireEvent.click(screen.getByRole('button', { name: 'About Mission Designer' }))
    expect(screen.getByText(`Mission Designer build 9.9.9`)).toBeTruthy()
    expect(screen.getByText('Visual workflow specification editor')).toBeTruthy()
  })

  it('shows the gear only to administrators, and it opens /admin', () => {
    const { unmount } = render(<AuthenticatedLayout />)
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
    unmount()
    ctx.user = { name: 'Ada', isAdministrator: true }
    render(<AuthenticatedLayout />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/admin' })
  })

  it('marks the gear active on /admin only', () => {
    ctx.user = { name: 'Ada', isAdministrator: true }
    const { unmount } = render(<AuthenticatedLayout />)
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-pressed')).not.toBe('true')
    unmount()
    pathname = '/admin'
    render(<AuthenticatedLayout />)
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('Sign out with unsaved work shows the unsaved dialog and does not sign out', async () => {
    useSpecificationStore.setState((s) => {
      s.savingIds.add('r')
    })
    render(<AuthenticatedLayout />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(screen.getByText('Unsaved Changes')).toBeTruthy())
    expect(navigate).not.toHaveBeenCalled()
  })
})
