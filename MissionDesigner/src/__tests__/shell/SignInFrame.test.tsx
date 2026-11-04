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

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SignInFrame } from '@mission/ui'

describe('SignInFrame', () => {
  it('renders art, copyright, description, children in order', () => {
    const { container } = render(
      <SignInFrame splashSrc="/s.png" splashAlt="Splash" description="Desc here">
        <form aria-label="card" />
      </SignInFrame>,
    )
    const img = screen.getByAltText('Splash')
    const copy = screen.getByText('Copyright 2026 Dennis L. Brandl · Apache License 2.0')
    const desc = screen.getByText('Desc here')
    const card = screen.getByRole('form', { name: 'card' })
    expect(img.getAttribute('src')).toBe('/s.png')
    const order = Array.from(container.querySelectorAll('img, p, form'))
    expect(order).toEqual([img, copy, desc, card])
  })
})
