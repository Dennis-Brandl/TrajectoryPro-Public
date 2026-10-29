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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { PropertiesPanel } from '@/components/properties/PropertiesPanel'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'

vi.mock('@/hooks/useCanEditActiveSpec', () => ({ useCanEditActiveSpec: vi.fn() }))
vi.mock('@/components/properties/WorkflowInlineEditor', () => ({ WorkflowInlineEditor: () => <input /> }))
vi.mock('@/components/properties/NodeInlineEditor', () => ({ NodeInlineEditor: () => <input /> }))
vi.mock('@/components/properties/EdgeConditionEditor', () => ({ EdgeConditionEditor: () => <input /> }))

function renderPanel() {
  return render(
    <ReactFlowProvider>
      <PropertiesPanel onCollapse={() => {}} />
    </ReactFlowProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('PropertiesPanel read-only', () => {
  it('wraps content in a disabled fieldset when editing is not allowed', () => {
    vi.mocked(useCanEditActiveSpec).mockReturnValue(false)
    const { container } = renderPanel()
    const fs = container.querySelector('fieldset')
    expect(fs).not.toBeNull()
    expect((fs as HTMLFieldSetElement).disabled).toBe(true)
  })

  it('fieldset is enabled when editing is allowed', () => {
    vi.mocked(useCanEditActiveSpec).mockReturnValue(true)
    const { container } = renderPanel()
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(false)
  })
})
