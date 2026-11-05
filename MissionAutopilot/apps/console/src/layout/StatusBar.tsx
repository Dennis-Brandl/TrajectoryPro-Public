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
import { Copy } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useDashboard } from '@/features/dashboard/hooks'
import { api } from '@/lib/api'

export default function StatusBar() {
  const { data } = useDashboard()
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
    <footer className="flex flex-wrap items-center gap-y-1 min-h-9 px-3 py-1 bg-status-bar border-t border-border text-sm text-muted-foreground shrink-0">
      <span>
        {data
          ? `${data.environments.total_count} environments | ${data.environments.total_actions} actions`
          : 'Loading...'}
      </span>
      <div className="flex-1" />
      <div
        className="ml-4 flex items-center gap-1.5"
        title="Browser-reachable REST base URL — for the Mission Autopilot Tester and for Mission Designer environment specs. Do NOT append /trajectory/v1/. The engine and Mission Commander use the Mission Commander address instead."
      >
        <span className="text-muted-foreground/70">Server:</span>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
          {serverUrl}
        </code>
      </div>
      {serverInfo?.fleet_base_url && (
        <div
          className="ml-3 flex items-center gap-1.5"
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
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
      )}
    </footer>
  )
}
