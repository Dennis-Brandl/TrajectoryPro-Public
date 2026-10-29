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

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type PanelId = 'explorer' | 'instances' | 'search'
type Theme = 'dark' | 'light'

interface PanelContextValue {
  activePanel: PanelId | null
  setActivePanel: (panel: PanelId | null) => void
  togglePanel: (panel: PanelId) => void
  theme: Theme
  toggleTheme: () => void
  codeFilterActive: boolean
  toggleCodeFilter: () => void
  searchQuery: string
  setSearchQuery: (q: string) => void
}

const PanelContext = createContext<PanelContextValue | null>(null)

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('mission-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return 'dark'
}

function getInitialPanel(): PanelId | null {
  const stored = localStorage.getItem('mission-active-panel')
  if (stored === 'explorer' || stored === 'instances' || stored === 'search') return stored
  return 'explorer'
}

function getInitialCodeFilter(): boolean {
  return localStorage.getItem('mission-code-filter') === 'true'
}

export function PanelProvider({ children }: { children: ReactNode }) {
  const [activePanel, setActivePanelState] = useState<PanelId | null>(getInitialPanel)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [codeFilterActive, setCodeFilterActive] = useState(getInitialCodeFilter)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('mission-theme', theme)
  }, [theme])

  useEffect(() => {
    if (activePanel) {
      localStorage.setItem('mission-active-panel', activePanel)
    } else {
      localStorage.removeItem('mission-active-panel')
    }
  }, [activePanel])

  useEffect(() => {
    localStorage.setItem('mission-code-filter', String(codeFilterActive))
  }, [codeFilterActive])

  function setActivePanel(panel: PanelId | null) {
    setActivePanelState(panel)
  }

  function togglePanel(panel: PanelId) {
    setActivePanelState((prev) => (prev === panel ? null : panel))
  }

  function toggleTheme() {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  function toggleCodeFilter() {
    setCodeFilterActive((prev) => !prev)
  }

  return (
    <PanelContext.Provider
      value={{
        activePanel,
        setActivePanel,
        togglePanel,
        theme,
        toggleTheme,
        codeFilterActive,
        toggleCodeFilter,
        searchQuery,
        setSearchQuery,
      }}
    >
      {children}
    </PanelContext.Provider>
  )
}

export function usePanelContext(): PanelContextValue {
  const ctx = useContext(PanelContext)
  if (!ctx) throw new Error('usePanelContext must be used within PanelProvider')
  return ctx
}
