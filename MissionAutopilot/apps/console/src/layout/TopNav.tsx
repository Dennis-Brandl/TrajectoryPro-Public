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

import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router'
import { Sun, Moon, Search, Copy } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { usePanelContext } from './PanelContext'
import { api } from '@/lib/api'
import { clearApiKey, UNAUTHORIZED_EVENT } from '@/lib/apiKey'
import { cn } from '@mission/ui'

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/environments', label: 'Environments', end: false },
  { to: '/log', label: 'Log', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

// The Action Tester (MissionAutopilotTester) is a separate application on
// its own port, not something this server's /server-info endpoint reports.
// There is still no client-config mechanism in this console for external tool
// URLs, so the link follows the host the console was opened on: a console
// opened at http://plant-pc:3003 links to http://plant-pc:3004, one opened on
// localhost links to localhost. The tester's compose service is published on
// :3004 (docs/superpowers/specs/2026-08-07-action-tester-port-design.md).
export function actionTesterUrl(
  loc: Pick<Location, 'protocol' | 'hostname'> = window.location
): string {
  return `${loc.protocol}//${loc.hostname}:3004`
}

export default function TopNav() {
  const { theme, toggleTheme, searchQuery, setSearchQuery, setActivePanel } = usePanelContext()
  // 'idle' | 'copied' | 'fallback' — 'fallback' covers both a missing
  // navigator.clipboard (non-secure context, e.g. a LAN-exposed console)
  // and a rejected writeText() (permission denied). Either way the address
  // is selected for a manual copy instead of silently doing nothing.
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'fallback'>('idle')
  const fleetAddressRef = useRef<HTMLElement>(null)
  const copyStatusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return () => clearTimeout(copyStatusTimerRef.current)
  }, [])

  // Fetch the externally-reachable REST URL from the server itself rather
  // than deriving it from window.location.origin. The console runs on a
  // different port than the REST API (Vite :5176 in dev, nginx :3003 in
  // Docker), so window.location.origin used to show the console's URL —
  // which doesn't serve the REST API root (`Cannot GET /`) and isn't the
  // address workflow authors should be copying into action_server_specifications.
  // See server/src/routes/management.ts → `GET /server-info`.
  const { data: serverInfo } = useQuery({
    queryKey: ['server-info'],
    queryFn: () => api.serverInfo(),
    staleTime: Infinity, // The bound URL doesn't change for the life of the process.
  })
  // Display the BASE URL only (no `/trajectory/v1/` suffix). Every consumer
  // — MissionAutopilotTester (`packages/.../api/*.ts: connection.url + '/trajectory/v1/...'`)
  // and TrajectoryRuntime (`ActionApiClient: serverUri + '/trajectory/v1/...'`) —
  // takes the base URL and appends the protocol path itself; pasting in a URL
  // that already ends in `/trajectory/v1/` produces a double-prefix 404.
  // protocol_path is still returned by the API for tooltips/docs but is NOT
  // part of what the user should copy.
  const serverUrl = serverInfo
    ? serverInfo.rest_base_url
    : // Pre-fetch fallback: synthesize a base-only URL from the current
      // origin so the header never renders empty. The server-info value
      // replaces it once the query resolves (typically within a frame on
      // local dev). Still wrong-port in dev (shows console's port), but
      // at least it's the right SHAPE (no /trajectory/v1/ suffix).
      window.location.origin

  return (
    <header className="flex items-center h-10 px-3 bg-[var(--activity-bar)] border-b border-border shrink-0">
      <div className="flex items-center gap-2 mr-6">
        <img
          src="/ic_launcher_round.png"
          alt="Trajectory Pro Mission Control"
          className="h-6 w-6 object-contain"
        />
        <span className="text-sm font-semibold text-foreground">Mission Autopilot</span>
        <span className="text-xs text-muted-foreground">v{__APP_VERSION__}</span>
      </div>
      <nav className="flex items-center gap-0.5">
        {navItems.map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'px-3 py-1.5 text-xs font-medium rounded-t transition-colors',
                isActive
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <div
        className="ml-4 flex items-center gap-1.5 text-xs text-muted-foreground"
        title="Browser-reachable REST base URL — for the Mission Autopilot Tester and for Mission Designer environment specs. Do NOT append /trajectory/v1/. The engine and Mission Commander use the Mission Commander address instead."
      >
        <span className="text-muted-foreground/70">Server:</span>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
          {serverUrl}
        </code>
      </div>
      {serverInfo?.fleet_base_url && (
        <div
          className="ml-3 flex items-center gap-1.5 text-xs text-muted-foreground"
          title="Address the Mission Engine and Mission Commander use to reach this server from inside the Docker network. Paste it into the Mission Commander's Action Server field (work center → Environments) and into Settings → Allowed action servers. Do not use the browser address (localhost) there — inside the fleet, localhost is a different machine."
        >
          <span className="text-muted-foreground/70">Mission Commander address:</span>
          <code
            ref={fleetAddressRef}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground"
          >
            {serverInfo.fleet_base_url}
          </code>
          <button
            type="button"
            aria-label="Copy Mission Commander address"
            className="rounded px-1 hover:bg-muted"
            onClick={() => {
              clearTimeout(copyStatusTimerRef.current)
              const showStatus = (status: 'copied' | 'fallback') => {
                setCopyStatus(status)
                copyStatusTimerRef.current = setTimeout(() => setCopyStatus('idle'), 1500)
              }
              const selectAddressForManualCopy = () => {
                if (fleetAddressRef.current) {
                  window.getSelection()?.selectAllChildren(fleetAddressRef.current)
                }
              }
              if (!navigator.clipboard?.writeText) {
                selectAddressForManualCopy()
                showStatus('fallback')
                return
              }
              void navigator.clipboard
                .writeText(serverInfo.fleet_base_url!)
                .then(() => showStatus('copied'))
                .catch(() => {
                  selectAddressForManualCopy()
                  showStatus('fallback')
                })
            }}
          >
            {copyStatus === 'copied' ? (
              'Copied'
            ) : copyStatus === 'fallback' ? (
              'Select and copy'
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      )}
      <a
        href={actionTesterUrl()}
        target="_blank"
        rel="noreferrer"
        className="ml-2 px-2 py-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs font-medium"
        title="Open the Mission Autopilot Tester in a new tab"
      >
        Mission Autopilot Tester
      </a>
      <div className="flex-1" />
      <div className="flex items-center gap-2 px-2 py-1 rounded bg-muted text-muted-foreground text-xs w-48 focus-within:ring-1 focus-within:ring-primary">
        <Search size={12} className="shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setActivePanel('search')}
          placeholder="Search..."
          className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
        />
      </div>
      <a
        href="/help.html"
        target="_blank"
        rel="noopener noreferrer"
        className="ml-2 px-2 py-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs font-medium"
        title="Open the help guide"
      >
        Help
      </a>
      <button
        type="button"
        onClick={() => {
          clearApiKey()
          window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { signOut: true } }))
        }}
        className="ml-2 px-2 py-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-xs font-medium"
        title="Forget the API key and return to the sign-in screen"
      >
        Sign out
      </button>
      <button
        onClick={toggleTheme}
        className="ml-3 p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>
    </header>
  )
}
