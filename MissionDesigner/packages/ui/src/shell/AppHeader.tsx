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

import { useRef, useState, type ReactNode } from 'react'
import { HelpCircle, LogOut, Moon, Settings, Sun } from 'lucide-react'
import { Button } from '../primitives/button'
import { AboutDialog } from './AboutDialog'

export interface AppHeaderProps {
  appName: string
  /** The app's own build number, shown only in About. */
  buildVersion: string
  /** Shown only in About. */
  tagline: string
  /** App-specific controls between the logo and the fixed group. */
  tools?: ReactNode
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  /** No gear when omitted. */
  onOpenSettings?: () => void
  settingsActive?: boolean
  /** No name when empty. */
  userName?: string | null
  onSignOut: () => void
  helpHref?: string
  /** Tooltip for the Sign out button. */
  signOutTitle?: string
}

export function AppHeader({
  appName,
  buildVersion,
  tagline,
  tools,
  theme,
  onToggleTheme,
  onOpenSettings,
  settingsActive,
  userName,
  onSignOut,
  helpHref = '/help.html',
  signOutTitle,
}: AppHeaderProps) {
  const [aboutOpen, setAboutOpen] = useState(false)
  const aboutIconRef = useRef<HTMLButtonElement>(null)
  const themeLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-activity-bar px-3">
      <button
        ref={aboutIconRef}
        type="button"
        aria-label={`About ${appName}`}
        title={`About ${appName}`}
        onClick={() => setAboutOpen(true)}
        className="shrink-0 rounded p-0.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <img src="/ic_launcher_round.png" alt="" className="size-6" />
      </button>
      <span className="shrink-0 whitespace-nowrap text-sm font-semibold">{appName}</span>
      <span className="mr-3 shrink-0 text-xs text-muted-foreground">v{buildVersion}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-xs">{tools}</div>

      <Button variant="ghost" size="sm" asChild className="shrink-0">
        <a href={helpHref} target="_blank" rel="noopener noreferrer" title="Open the user guide in a new tab">
          <HelpCircle className="size-4" />
          Help
        </a>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={onToggleTheme}
        aria-label={themeLabel}
        title={themeLabel}
      >
        {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </Button>
      {onOpenSettings && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
          aria-pressed={settingsActive}
        >
          <Settings className="size-4" />
        </Button>
      )}
      {userName ? (
        <span className="hidden max-w-40 shrink-0 truncate text-xs text-muted-foreground lg:inline" title={userName}>
          {userName}
        </span>
      ) : null}
      <div className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
      <Button variant="ghost" size="sm" className="shrink-0" onClick={onSignOut} title={signOutTitle}>
        <LogOut className="size-4" />
        Sign out
      </Button>

      <AboutDialog
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        appName={appName}
        buildVersion={buildVersion}
        tagline={tagline}
        returnFocusRef={aboutIconRef}
      />
    </header>
  )
}
