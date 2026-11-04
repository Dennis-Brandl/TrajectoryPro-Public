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

import { Outlet, useLocation, useNavigate } from 'react-router'
import { ExternalLink } from 'lucide-react'
import { AppHeader } from '@mission/ui'
import ActivityBar from './ActivityBar'
import SidePanel from './SidePanel'
import StatusBar from './StatusBar'
import RightPane from './RightPane'
import { RightPaneProvider } from './RightPaneContext'
import { usePanelContext } from './PanelContext'
import { actionTesterUrl } from './tester-url'
import { clearApiKey, UNAUTHORIZED_EVENT } from '@/lib/apiKey'

export default function Layout() {
  const { theme, toggleTheme } = usePanelContext()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  return (
    <RightPaneProvider>
      <div className="flex flex-col h-screen bg-background">
        <AppHeader
          appName="Mission Autopilot"
          buildVersion={__APP_VERSION__}
          tagline="Runs the Python code behind environment actions"
          tools={
            <a
              href={actionTesterUrl()}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Open the Mission Autopilot Tester in a new tab"
            >
              Mission Autopilot Tester
              <ExternalLink className="size-3.5" />
            </a>
          }
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenSettings={() => void navigate('/settings')}
          settingsActive={pathname === '/settings'}
          signOutTitle="Forget the API key and return to the sign-in screen"
          onSignOut={() => {
            clearApiKey()
            window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { signOut: true } }))
          }}
        />
        <div className="flex flex-1 overflow-hidden">
          <ActivityBar />
          <SidePanel />
          <main className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
          <RightPane />
        </div>
        <StatusBar />
      </div>
    </RightPaneProvider>
  )
}
