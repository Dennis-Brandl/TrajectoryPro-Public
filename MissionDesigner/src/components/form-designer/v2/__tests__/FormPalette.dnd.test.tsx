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
import { render } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { FormPalette } from '../FormPalette'

describe('FormPalette draggable', () => {
  it('marks each palette entry as a draggable source (keeps click-insert)', () => {
    const { container } = render(
      <DndContext>
        <FormPalette />
      </DndContext>,
    )
    expect(container.querySelector('[data-palette-drag="palette:text"]')).not.toBeNull()
    expect(container.querySelector('[data-palette-drag="palette:timer"]')).not.toBeNull()
  })
})
