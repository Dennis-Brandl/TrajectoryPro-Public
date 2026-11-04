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
import { Badge, buttonVariants } from '@mission/ui'

describe('Badge destructive variant', () => {
  it('uses the same text and dark surface as the destructive button', () => {
    render(<Badge variant="destructive">Failed</Badge>)
    const cls = screen.getByText('Failed').className.split(/\s+/)
    const button = buttonVariants({ variant: 'destructive' }).split(/\s+/)
    for (const name of ['bg-destructive', 'text-white', 'dark:bg-destructive/60']) {
      expect(button).toContain(name)
      expect(cls).toContain(name)
    }
  })

  it('does not use the destructive-foreground token, which is not defined', () => {
    render(<Badge variant="destructive">Failed</Badge>)
    expect(screen.getByText('Failed').className).not.toContain('destructive-foreground')
  })
})
