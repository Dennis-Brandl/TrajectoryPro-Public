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

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppHeader } from '@mission/ui'
import { HeaderTools, HeaderToolsProvider, HeaderToolsSlot } from './HeaderTools'

describe('HeaderTools', () => {
  it('renders its children inside the header', () => {
    render(
      <HeaderToolsProvider>
        <AppHeader
          appName="Mission Designer"
          buildVersion="1"
          tagline="t"
          tools={<HeaderToolsSlot />}
          theme="dark"
          onToggleTheme={() => {}}
          onSignOut={() => {}}
        />
        <HeaderTools>
          <button>Auto-layout</button>
        </HeaderTools>
      </HeaderToolsProvider>,
    )
    const header = screen.getByRole('banner')
    expect(header.contains(screen.getByRole('button', { name: 'Auto-layout' }))).toBe(true)
  })
})
