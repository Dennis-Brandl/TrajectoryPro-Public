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

import { formatClock } from './format'

export interface ConnectionStatusProps {
  online: boolean
  /** true until the first live inbox fetch after entering the work center */
  stale: boolean
  /** online, but the engine is not answering (useInbox) */
  unreachable?: boolean
  syncedAt: Date | null
}

// Spec §5.1: icon + word + "synced HH:MM", in ok/warn status colours. Deliberately not a
// live region — the time changes on every poll; going offline is announced by the banner.
export function ConnectionStatus({ online, stale, unreachable = false, syncedAt }: ConnectionStatusProps) {
  const time = syncedAt ? formatClock(syncedAt) : null
  if (!online) {
    return (
      <span className="conn conn-warn">
        <span className="conn-icon" aria-hidden="true">○</span>
        <span className="conn-word">Offline</span>
        {time && <span className="conn-time"> · last synced {time}</span>}
      </span>
    )
  }
  if (unreachable) {
    return (
      <span className="conn conn-warn">
        <span className="conn-icon" aria-hidden="true">○</span>
        <span className="conn-word">Reconnecting…</span>
        {time && <span className="conn-time"> · last synced {time}</span>}
      </span>
    )
  }
  if (stale) {
    return (
      <span className="conn conn-wait">
        <span className="conn-icon" aria-hidden="true">◌</span>
        <span className="conn-word">Connecting…</span>
      </span>
    )
  }
  return (
    <span className="conn conn-ok">
      <span className="conn-icon" aria-hidden="true">●</span>
      <span className="conn-word">Online</span>
      {time && <span className="conn-time"> · synced {time}</span>}
    </span>
  )
}
