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

import { useState, useEffect } from 'react'

type Theme = 'light' | 'dark'

// With no saved choice the app starts dark, whatever the OS prefers.
function getInitialTheme(): Theme {
  const stored = localStorage.getItem('mission-theme') as Theme | null
  if (stored === 'light' || stored === 'dark') return stored
  return 'dark'
}

/** Applies the starting theme before the first render, so the sign-in and setup screens
 *  (which never call useTheme) open in it too and there is no light flash. */
export function applyInitialTheme(): void {
  document.documentElement.classList.toggle('dark', getInitialTheme() === 'dark')
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('mission-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))

  return { theme, toggleTheme }
}
