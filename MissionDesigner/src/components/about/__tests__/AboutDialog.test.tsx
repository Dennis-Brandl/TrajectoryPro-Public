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
import { render, screen } from '@testing-library/react'
import { AboutDialog } from '../AboutDialog'

describe('AboutDialog', () => {
  it('displays the product name when open', () => {
    render(<AboutDialog open onOpenChange={vi.fn()} version="9.9.9" />)
    expect(screen.getByText('Mission Designer')).toBeTruthy()
  })

  it('displays the version passed in', () => {
    render(<AboutDialog open onOpenChange={vi.fn()} version="9.9.9" />)
    expect(screen.getByText(/Version\s*9\.9\.9/)).toBeTruthy()
  })

  it('displays the Apache-licensed copyright', () => {
    render(<AboutDialog open onOpenChange={vi.fn()} version="9.9.9" />)
    expect(
      screen.getByText('Copyright 2026 Dennis L. Brandl. Licensed under the Apache License, Version 2.0.'),
    ).toBeTruthy()
  })

  it('renders no content when closed', () => {
    render(<AboutDialog open={false} onOpenChange={vi.fn()} version="9.9.9" />)
    expect(screen.queryByText('Mission Designer')).toBeNull()
  })
})
