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
import { render, cleanup } from '@testing-library/react'
import { RuntimeId } from '../RuntimeId'

afterEach(cleanup)

describe('RuntimeId', () => {
  it('renders the whole ID as its text and title, with the last segment split off to stay whole', () => {
    const { container } = render(<RuntimeId label="MIX-20261009-0002" />)
    const rid = container.querySelector('.rid')!
    expect(rid.textContent).toBe('MIX-20261009-0002')
    expect(rid.getAttribute('title')).toBe('MIX-20261009-0002')
    expect(rid.querySelector('.elide-head')!.textContent).toBe('MIX-20261009-')
    expect(rid.querySelector('.elide-tail')!.textContent).toBe('0002')
  })
})
