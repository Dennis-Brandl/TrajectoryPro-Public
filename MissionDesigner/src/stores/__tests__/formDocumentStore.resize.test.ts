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
import { describe, it, expect, beforeEach } from 'vitest'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import type { FormDocument } from '@mission/form-schema'

const twoBlockDoc: FormDocument = {
  version: 2,
  sections: [
    {
      id: 'sec',
      role: 'content',
      rows: [
        {
          id: 'row',
          blocks: [
            { id: 'L', type: 'text', content: '', layout: { span: { base: 6 } } },
            { id: 'R', type: 'text', content: '', layout: { span: { base: 6 } } },
          ],
        },
      ],
    },
  ],
}
const spanOf = (id: string) => {
  const b = useFormDocumentStore.getState().document.sections[0].rows[0].blocks.find((x) => x.id === id)!
  return (b.layout!.span as { base: number }).base
}

beforeEach(() => {
  useFormDocumentStore.getState().openForNode('n', structuredClone(twoBlockDoc))
})

describe('formDocumentStore.resizeSpan', () => {
  it('redistributes and records exactly one undo entry', () => {
    useFormDocumentStore.getState().resizeSpan('L', 'R', 2)
    expect(spanOf('L')).toBe(8)
    expect(spanOf('R')).toBe(4)
    expect(useFormDocumentStore.temporal.getState().pastStates.length).toBe(1)
  })

  it('is a no-op (no undo entry) when the delta changes nothing', () => {
    useFormDocumentStore.getState().resizeSpan('L', 'R', 0)
    expect(useFormDocumentStore.temporal.getState().pastStates.length).toBe(0)
  })

  it('each call is its own undo step', () => {
    useFormDocumentStore.getState().resizeSpan('L', 'R', 1)
    useFormDocumentStore.getState().resizeSpan('L', 'R', 1)
    expect(spanOf('L')).toBe(8)
    expect(useFormDocumentStore.temporal.getState().pastStates.length).toBe(2)
  })
})
