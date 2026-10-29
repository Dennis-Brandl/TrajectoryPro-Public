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

import type { WorkCenter } from '../api/types'
import type { PilotMode, PilotPrefs } from '../theme/prefs'
import { useAppTitle } from './app-title'
import { ConnectionStatus } from './ConnectionStatus'
import { OperatorMenu } from './OperatorMenu'
import { WorkCenterSwitcher } from './WorkCenterSwitcher'
import { BrandLogo } from './brand-logo'

export interface TopBarProps {
  wc: WorkCenter
  onSwitchWorkCenter(wc: WorkCenter): void
  online: boolean
  stale: boolean
  unreachable: boolean
  syncedAt: Date | null
  operatorName: string
  away: boolean
  onToggleAway(): void
  onSignOut(): void
  signingOut?: boolean
  prefs: PilotPrefs
  onPrefsChange(next: PilotPrefs): void
  defaultMode?: PilotMode
}

// Spec §5.1/§12. The logo slot shows the theme's logo (the app mark until one is uploaded). Below 1024 px only
// the mark, the work-center switcher, the status icon and the operator button stay visible
// (frame.css); the title and status words remain for screen readers.
export function TopBar(p: TopBarProps) {
  const appTitle = useAppTitle()
  return (
    <header className="top-bar">
      <div className="top-brand">
        <BrandLogo className="top-logo" fallbackClassName="top-logo" fallbackSrc="/icon.svg" fallbackAlt="" logoAlt="" decorative />
        <h1 className="top-title">{appTitle}</h1>
      </div>
      <WorkCenterSwitcher current={p.wc} onSwitch={p.onSwitchWorkCenter} />
      <ConnectionStatus online={p.online} stale={p.stale} unreachable={p.unreachable} syncedAt={p.syncedAt} />
      <OperatorMenu
        name={p.operatorName}
        away={p.away}
        onToggleAway={p.onToggleAway}
        onSignOut={p.onSignOut}
        signingOut={p.signingOut}
        prefs={p.prefs}
        onPrefsChange={p.onPrefsChange}
        defaultMode={p.defaultMode}
      />
    </header>
  )
}
