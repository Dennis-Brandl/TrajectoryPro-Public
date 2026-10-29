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
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { SessionProvider, useSession } from './session'
import { usePresence } from './presence'
import { Toasts } from './toast'
import { TopBar } from './frame/TopBar'
import { LoginScreen } from './screens/LoginScreen'
import { WorkCenterPicker } from './screens/WorkCenterPicker'
import { WorkView } from './screens/WorkView'
import { useInbox } from './inbox-data'
import { usePilotPrefs, DEFAULT_MODE } from './theme/prefs'
import { useSiteTheme, applyThemeColor } from './theme/site-theme'
import { AppTitleContext, APP_TITLE } from './frame/app-title'
import { BrandLogoContext, type BrandLogos } from './frame/brand-logo'
import type { WorkCenter } from './api/types'

const OFFLINE_BANNER_COPY = 'Offline — showing the last known inbox. Actions are disabled.'

// ~6 lines of window on/offline listening — the global banner and the `offline`
// prop threaded into the panes' TaskScreens both read this; useInbox has its own
// separate online/offline listener for the inbox's claim/release button disabling,
// which is intentionally independent of this one.
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return online
}

function AuthedApp() {
  const session = useSession()
  const [selectedWc, setSelectedWc] = useState<WorkCenter | null>(null)
  // Spec §13: the site theme (P3: the work center's) — cached first, then live.
  const theme = useSiteTheme(selectedWc ? selectedWc.id : null)
  const appTitle = theme?.theme.appTitle ?? APP_TITLE
  const defaultMode = theme?.theme.defaultMode ?? DEFAULT_MODE
  const logos = useMemo<BrandLogos>(
    () => ({ logo: theme?.theme.logo ?? null, logoDark: theme?.theme.logoDark ?? null }),
    [theme],
  )
  // Display prefs apply on every screen, the login screen included (spec §8.2); the theme's
  // defaultMode applies until the operator chooses.
  const [prefs, setPrefs] = usePilotPrefs(defaultMode)
  // After usePilotPrefs' effect has set data-pilot-mode, so the colour matches the mode.
  useEffect(() => {
    if (theme) applyThemeColor(theme)
  }, [theme, prefs, defaultMode])
  const online = useOnline()
  const presence = usePresence(selectedWc ? selectedWc.id : null)
  // Lifted to app level (auto-claim spec §6): SSE/poll stay live while the operator
  // works inside panes, so chained and force-released claims reach the work view
  // without a trip back to a dedicated inbox screen.
  const inbox = useInbox(selectedWc ? selectedWc.id : null)
  // The payload's live name wins (spec §5.7), so a rename in Commander reaches the
  // switcher and the context bar alike; a snapshot from the previous work center never does.
  const liveWcName =
    selectedWc && inbox.snapshot?.workCenterId === selectedWc.id ? (inbox.snapshot.workCenterName ?? null) : null
  // WorkView owns the title while it is mounted; the login screen and the picker use the app title.
  const inWorkView = !!session.user && !!selectedWc
  useEffect(() => {
    if (!inWorkView) document.title = appTitle
  }, [appTitle, inWorkView])

  const [signingOut, setSigningOut] = useState(false)
  const handleSignOut = async () => {
    // Keep the await: a late Set-Cookie from a fire-and-forget logout could clobber the next operator's cookie.
    setSigningOut(true)
    try {
      await session.signOut()
    } finally {
      setSigningOut(false)
    }
    // Start the next login fresh at the picker; WorkView unmounts with it, dropping
    // any open panes and tab focus.
    setSelectedWc(null)
  }

  let content: ReactElement
  if (!session.ready) {
    content = <p role="status">Loading…</p>
  } else if (!session.user) {
    content = <LoginScreen />
  } else {
    content = (
      // Spec §1/§4: the chrome sits outside the one scrolling region, so work center,
      // workflow and runtime ID stay on screen however far the form scrolls.
      <div className="app-shell">
        {!online && <p className="banner banner-warn">{OFFLINE_BANNER_COPY}</p>}

        {!selectedWc ? (
          <div className="app-scroll">
            <WorkCenterPicker onSelect={setSelectedWc} onSignOut={handleSignOut} signingOut={signingOut} />
          </div>
        ) : (
          <>
            <TopBar
              wc={liveWcName ? { ...selectedWc, name: liveWcName } : selectedWc}
              onSwitchWorkCenter={setSelectedWc}
              online={online}
              stale={inbox.stale}
              unreachable={inbox.unreachable}
              syncedAt={inbox.syncedAt}
              operatorName={session.user.displayName}
              away={presence.away}
              onToggleAway={presence.toggleAway}
              onSignOut={handleSignOut}
              signingOut={signingOut}
              prefs={prefs}
              onPrefsChange={setPrefs}
              defaultMode={defaultMode}
            />

            {presence.error && (
              <p role="alert" className="banner banner-alarm">
                {presence.error}
              </p>
            )}

            {/* Keyed by work center: switching resets tab focus and closed-pane state. */}
            <WorkView
              key={selectedWc.id}
              wcId={selectedWc.id}
              snapshot={inbox.snapshot}
              stale={inbox.stale}
              inboxOffline={inbox.offline}
              offline={!online}
              refresh={inbox.refresh}
              wcName={liveWcName ?? selectedWc.name}
              layout={prefs.layout}
            />
          </>
        )}
      </div>
    )
  }

  return (
    <AppTitleContext.Provider value={appTitle}>
      <BrandLogoContext.Provider value={logos}>{content}</BrandLogoContext.Provider>
    </AppTitleContext.Provider>
  )
}

export function App() {
  return (
    <SessionProvider>
      <Toasts />
      <AuthedApp />
    </SessionProvider>
  )
}
