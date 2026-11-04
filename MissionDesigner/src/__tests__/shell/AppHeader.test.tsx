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

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppHeader } from '@mission/ui'

const user = userEvent.setup()

function renderHeader(props: Partial<React.ComponentProps<typeof AppHeader>> = {}) {
  return render(
    <AppHeader
      appName="Mission Designer"
      buildVersion="2.1.1"
      tagline="Visual workflow specification editor"
      theme="light"
      onToggleTheme={vi.fn()}
      onSignOut={vi.fn()}
      onOpenSettings={vi.fn()}
      userName="Ada Lovelace"
      {...props}
    />,
  )
}

describe('AppHeader', () => {
  it('opens About when the title-bar icon is clicked', async () => {
    renderHeader()
    await user.click(screen.getByRole('button', { name: 'About Mission Designer' }))
    const d = screen.getByRole('dialog')
    expect(within(d).getByText('Mission Designer')).toBeTruthy()
    expect(within(d).getByText('Version 2.1.1')).toBeTruthy()
    expect(within(d).getByText('Mission Designer build 2.1.1')).toBeTruthy()
    expect(within(d).getByText(/Copyright 2026 Dennis L. Brandl/)).toBeTruthy()
  })

  it('opens About from the keyboard and returns focus to the icon', async () => {
    renderHeader()
    const icon = screen.getByRole('button', { name: 'About Mission Designer' })
    icon.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    // Radix restores focus on a timer after unmount.
    await waitFor(() => expect(document.activeElement).toBe(icon))
  })

  it("shows the app's own version in the bar", () => {
    renderHeader()
    expect(screen.getByText('v2.1.1')).toBeTruthy()
  })

  it('keeps the fixed group in order', () => {
    renderHeader()
    const help = screen.getByRole('link', { name: 'Help' })
    expect(help.getAttribute('href')).toBe('/help.html')
    expect(help.getAttribute('target')).toBe('_blank')
    const theme = screen.getByRole('button', { name: 'Switch to dark mode' })
    const settings = screen.getByRole('button', { name: 'Settings' })
    const name = screen.getByText('Ada Lovelace')
    const signOut = screen.getByRole('button', { name: 'Sign out' })
    const order = [help, theme, settings, name, signOut]
    for (let i = 0; i < order.length - 1; i++) {
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('omits the gear and user name when not supplied', () => {
    renderHeader({ onOpenSettings: undefined, userName: null })
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
    expect(screen.queryByText('Ada Lovelace')).toBeNull()
  })
})
