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

import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { App } from './App'
import { renderWithProviders } from './test-utils'

describe('App shell', () => {
  it('renders the two-pane shell landmarks', () => {
    renderWithProviders(<App />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /sidebar/i })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: /inspector/i })).not.toBeInTheDocument()
  })

  it('shows the Connections sidebar section', () => {
    renderWithProviders(<App />)
    expect(
      screen.getByRole('button', { name: /connections/i, expanded: true })
    ).toBeInTheDocument()
  })

  it('shows the Actions sidebar section', () => {
    renderWithProviders(<App />)
    expect(
      screen.getByRole('button', { name: /^actions$/i, expanded: true })
    ).toBeInTheDocument()
  })

  it('shows the Instances sidebar section', () => {
    renderWithProviders(<App />)
    expect(
      screen.getByRole('button', { name: /^instances$/i, expanded: true })
    ).toBeInTheDocument()
  })

  it('main pane defaults to the idle placeholder', () => {
    renderWithProviders(<App />)
    expect(
      screen.getByText(/select an action or instance from the sidebar/i)
    ).toBeInTheDocument()
  })
})
