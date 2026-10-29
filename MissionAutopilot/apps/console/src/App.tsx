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

import { useEffect, useState } from 'react'
import { Routes, Route } from 'react-router'
import Layout from './layout/Layout'
import { PanelProvider } from './layout/PanelContext'
import { WelcomeSplash } from './components/WelcomeSplash'
import { SignInScreen, REJECTED } from './components/SignInScreen'
import { getApiKey, UNAUTHORIZED_EVENT } from './lib/apiKey'
import DashboardPage from './features/dashboard/DashboardPage'
import EnvironmentsPage from './features/environments/EnvironmentsPage'
import EnvironmentDetailPage from './features/environments/EnvironmentDetailPage'
import ActionDetailPage from './features/actions/ActionDetailPage'
import InlineCodeEditorPage from './features/code-editor/InlineCodeEditorPage'
import InstancesPage from './features/instances/InstancesPage'
import InstanceDetailPage from './features/instances/InstanceDetailPage'
import LogPage from './features/log/LogPage'
import SettingsPage from './features/settings/SettingsPage'

export default function App() {
  const [splashDismissed, setSplashDismissed] = useState(false)
  const [signedIn, setSignedIn] = useState(() => getApiKey() !== null)
  // True only after the server rejected the key mid-session; explicit sign out stays blank.
  const [rejected, setRejected] = useState(false)

  useEffect(() => {
    const onUnauthorized = (e: Event) => {
      const explicit =
        (e as CustomEvent<{ signOut?: boolean } | undefined>).detail?.signOut === true
      setRejected(!explicit)
      setSignedIn(false)
      setSplashDismissed(true)
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  // The splash opens the app, before sign-in, so a fresh sign-in goes straight to the console.
  if (!splashDismissed) {
    return <WelcomeSplash onContinue={() => setSplashDismissed(true)} />
  }

  if (!signedIn) {
    return (
      <SignInScreen
        onSignedIn={() => {
          setRejected(false)
          setSignedIn(true)
        }}
        initialError={rejected ? REJECTED : null}
      />
    )
  }

  return (
    <PanelProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="environments" element={<EnvironmentsPage />} />
          <Route path="environments/:oid" element={<EnvironmentDetailPage />} />
          <Route path="actions/:oid" element={<ActionDetailPage />} />
          <Route path="actions/:oid/code/:state" element={<InlineCodeEditorPage />} />
          <Route path="instances" element={<InstancesPage />} />
          <Route path="instances/:id" element={<InstanceDetailPage />} />
          <Route path="log" element={<LogPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </PanelProvider>
  )
}
