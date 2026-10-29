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

import { createFileRoute, Outlet, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { authClient, signOut } from '@/lib/auth-client'
import { Button } from '@mission/ui'
import { LogOut, User, Settings } from 'lucide-react'
import { BootErrorScreen } from '@/components/BootErrorScreen'
import { DebugPanel } from '@/components/debug/DebugPanel'
import { UnsavedChangesAlert } from '@/components/properties/UnsavedChangesAlert'
import { SaveErrorToast } from '@/components/dialogs/SaveErrorToast'
import { LibrarySaveErrorToast } from '@/components/dialogs/LibrarySaveErrorToast'
import { useLibraryStore } from '@/stores/libraryStore'
import { useFlowStore } from '@/stores/flowStore'
import { useWorkflowSessionStore, logoutWhenSaved } from '@/stores/workflowSessionStore'
import { usePrincipalStore } from '@/stores/principalStore'
import { installNavigationGuard } from '@/stores/specificationStore/saveScheduler'
import { runBoot } from '@/stores/specificationStore/bootSequence'
import { getSetupStatus } from '@/lib/setupClient'
import { signOutQuietly, getSessionOrUnreachable } from '@/lib/sessionGuards'
import { useEffect } from 'react'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const session = await getSessionOrUnreachable(() => authClient.getSession())
    if (session.unreachable) {
      // Server fully stopped: show the boot error screen, not the router's default error page.
      return { user: null, bootError: { detail: "Can't reach the server" } }
    }
    if (!session.data) {
      throw redirect({ to: '/login' })
    }
    const sessionUser = session.data.user
    // First-run gate (before booting libraries): an un-bootstrapped install sends
    // the authenticated operator into the wizard. A transient status-fetch failure
    // does NOT trap them — we fall through to the app.
    let setupStatus
    try {
      setupStatus = await getSetupStatus()
    } catch {
      setupStatus = null
    }
    if (setupStatus && !setupStatus.setupComplete) throw redirect({ to: '/setup' })
    // Boot specificationStore: load /api/v2/me then /api/v2/libraries
    const bootResult = await runBoot()
    if (!bootResult.ok) {
      console.error('[boot] failed:', bootResult.error, bootResult.detail)
      if (bootResult.error === 'me') {
        if (bootResult.unauthorized) throw redirect({ to: '/login' })
        // Signed in but /me failed for another reason: show the error screen
        // (redirecting to /login would bounce straight back here, forever).
        return { user: sessionUser, bootError: { detail: bootResult.detail } }
      }
    }
    return { user: sessionUser, bootError: null }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const navigate = useNavigate()
  const router = useRouter()
  const { user, bootError } = Route.useRouteContext()

  const showUnsavedDialog = useWorkflowSessionStore((s) => s.showUnsavedDialog)

  // Install beforeunload guard for unsaved specs
  useEffect(() => {
    return installNavigationGuard()
  }, [])

  const performLogout = async () => {
    useWorkflowSessionStore.getState().clearSession()
    await signOutQuietly(() => signOut())
    usePrincipalStore.getState().clearPrincipal()
    // Clear persisted store state so the next login starts fresh
    useLibraryStore.setState({
      libraries: [],
      specifications: new Map(),
      childLibraries: new Map(),
      selectedLibraryId: null,
      selectedSpecificationId: null,
      selectedTeamId: null,
      searchQuery: '',
    })
    useFlowStore.setState({
      nodes: [],
      edges: [],
      workflowInputs: [],
      workflowOutputs: [],
      workflowValues: [],
      workflowResources: [],
      workflowTrySpecifications: [],
      hasDraft: false,
      draftAt: null,
      // Drop hydration tracking so the post-login route effect re-hydrates
      // before any writeThroughToSpec is allowed to fire.
      hydratedSpecId: null,
    })
    sessionStorage.removeItem('library-ui-state')
    navigate({ to: '/login' })
  }

  const handleLogout = async () => {
    // Drain pending specs AND libraries before deciding whether to prompt: a
    // failed save, or one still in flight, shows the unsaved dialog instead of
    // signing out. The browser-close (beforeunload) guard remains as the final
    // backstop if the user manages to close the tab during a flush.
    await logoutWhenSaved(performLogout)
  }

  const isAdmin = (user as { isAdministrator?: boolean })?.isAdministrator === true

  if (bootError) {
    return (
      <BootErrorScreen
        detail={bootError.detail}
        onRetry={() => router.invalidate()}
        onSignOut={() => void performLogout()}
      />
    )
  }

  return (
    <div className="h-screen w-screen flex flex-col">
      {/* Auth header overlay - positioned in the toolbar area */}
      <div className="absolute top-0 right-0 h-12 flex items-center gap-1 px-4 z-50 text-slate-600 dark:text-slate-200">
        {import.meta.env.DEV && <DebugPanel />}
        {isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-600 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
            title="Administration"
            onClick={() => navigate({ to: '/admin' })}
          >
            <Settings className="h-4 w-4" />
          </Button>
        )}
        <span className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-200 px-1">
          <User className="h-3.5 w-3.5" />
          {user?.name || user?.email || ''}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          title="Sign out"
          className="text-slate-600 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
      <Outlet />
      <SaveErrorToast />
      <LibrarySaveErrorToast />
      <UnsavedChangesAlert
        open={showUnsavedDialog}
        onSave={() => useWorkflowSessionStore.getState().handleSave()}
        onDiscard={() => useWorkflowSessionStore.getState().handleDiscard()}
        onKeepEditing={() => useWorkflowSessionStore.getState().handleKeepEditing()}
      />
    </div>
  )
}
