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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ParameterBindingSection } from '../ParameterBindingSection'
import { useFlowStore } from '@/stores/flowStore'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import type { TextInputBlock } from '@mission/form-schema'

const block: TextInputBlock = { id: 'b', type: 'textInput', fieldName: 'x', outputParameter: 'out1' }

beforeEach(() => {
  useFlowStore.setState({
    nodes: [
      {
        id: 'n',
        type: 'userInteractionStep',
        position: { x: 0, y: 0 },
        data: { outputs: [{ id: 'o', name: 'out1' }] },
      },
    ] as never,
  })
  useFormDocumentStore.getState().close()
  useFormDocumentStore
    .getState()
    .openForNode('n', { version: 2, sections: [{ id: 's', role: 'content', rows: [{ id: 'r', blocks: [block] }] }] })
})

describe('ParameterBindingSection', () => {
  it('lists the step outputs and updates the binding', () => {
    const onUpdate = vi.fn()
    render(<ParameterBindingSection block={block} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    expect(onUpdate).toHaveBeenCalledWith({ outputParameter: undefined })
  })
})
