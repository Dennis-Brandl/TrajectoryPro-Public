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

import { useState } from 'react'
import { Sheet } from './Sheet'
import { DEFAULT_MODE, TEXT_SCALES, type PilotMode, type PilotLayout, type PilotPrefs, type TextScale } from '../theme/prefs'

export interface OperatorMenuProps {
  name: string
  away: boolean
  onToggleAway(): void
  onSignOut(): void
  /** True while sign-out is waiting on the server (up to 15 s); the menu stays open to show it. */
  signingOut?: boolean
  prefs: PilotPrefs
  onPrefsChange(next: PilotPrefs): void
  /** The theme's defaultMode — shown while the operator has made no choice. */
  defaultMode?: PilotMode
}

// Spec §5.1 operator menu: name, Away/Back as a word, light/dark/system, text size, Sign Out.
// Takes over P1a's temporary header controls with the same props. Away also shows on the
// button itself, so an operator never forgets they set it.
export function OperatorMenu({ name, away, onToggleAway, onSignOut, signingOut = false, prefs, onPrefsChange, defaultMode = DEFAULT_MODE }: OperatorMenuProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="op-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span className="op-name">{name}</span>
        {away && (
          <>
            {' '}
            <span className="op-away">Away</span>
          </>
        )}
      </button>
      {open && (
        <Sheet label="Operator menu" onClose={() => setOpen(false)}>
          <p className="op-who">
            Signed in as <strong>{name}</strong>
          </p>
          <button type="button" onClick={onToggleAway}>
            {away ? 'Back' : 'Away'}
          </button>
          <label>
            Display
            <select
              value={prefs.mode ?? defaultMode}
              onChange={(e) => onPrefsChange({ ...prefs, mode: e.target.value as PilotMode })}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </label>
          <label>
            Text size
            <select
              value={String(prefs.textScale)}
              onChange={(e) => onPrefsChange({ ...prefs, textScale: Number(e.target.value) as TextScale })}
            >
              {TEXT_SCALES.map((s) => (
                <option key={s} value={String(s)}>
                  {Math.round(s * 100)}%
                </option>
              ))}
            </select>
          </label>
          <label>
            Layout
            <select
              value={prefs.layout}
              aria-describedby="layout-hint"
              onChange={(e) => onPrefsChange({ ...prefs, layout: e.target.value as PilotLayout })}
            >
              <option value="standard">Standard</option>
              <option value="workstation">Workstation</option>
            </select>
          </label>
          <p id="layout-hint" className="op-hint">
            Workstation shows the inbox beside the task on screens 1280 px and wider.
          </p>
          <button
            type="button"
            disabled={signingOut}
            onClick={onSignOut}
          >
            {signingOut ? 'Signing out…' : 'Sign Out'}
          </button>
        </Sheet>
      )}
    </>
  )
}
