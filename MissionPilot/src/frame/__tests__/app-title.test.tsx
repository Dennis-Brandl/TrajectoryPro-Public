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

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AppTitleContext, useAppTitle, APP_TITLE } from '../app-title'

afterEach(cleanup)

function Title() {
  return <h1>{useAppTitle()}</h1>
}

describe('app title (spec §7 appTitle)', () => {
  it('is Mission Pilot until a theme names the app', () => {
    render(<Title />)
    expect(screen.getByRole('heading').textContent).toBe(APP_TITLE)
    expect(APP_TITLE).toBe('Mission Pilot')
  })

  it('renders the theme title as text, never markup', () => {
    render(
      <AppTitleContext.Provider value="<b>Acme</b> Pilot">
        <Title />
      </AppTitleContext.Provider>,
    )
    expect(screen.getByRole('heading').textContent).toBe('<b>Acme</b> Pilot')
    expect(screen.getByRole('heading').querySelector('b')).toBeNull()
  })
})
