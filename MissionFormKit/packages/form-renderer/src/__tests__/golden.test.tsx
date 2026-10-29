// @vitest-environment jsdom
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
import { FormDocumentView } from '../FormDocumentView'
import { kitchenSinkDocument } from '@mission/form-schema'

describe('golden DOM — kitchen sink', () => {
  it('run mode DOM is pinned', () => {
    const { container } = render(
      <FormDocumentView
        document={kitchenSinkDocument}
        values={{ serial: 'SN-1', checks: ['seals'], grade: 'pass' }}
        images={(key) => `resolved:${key}`}
      />,
    )
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('edit mode DOM is pinned and differs from run mode only by documented attributes', () => {
    const run = render(<FormDocumentView document={kitchenSinkDocument} />).container.innerHTML
    const edit = render(<FormDocumentView document={kitchenSinkDocument} mode="edit" />).container.innerHTML
    expect(edit).toMatchSnapshot()
    // Spec §5: the only documented mode differences are data-mode and inert.
    // Nothing else may differ — that is the entire WYSIWYG guarantee.
    const normalize = (s: string) =>
      s.replaceAll(' inert=""', '').replace('data-mode="edit"', 'data-mode="run"')
    expect(normalize(edit)).toBe(normalize(run))
  })
})
