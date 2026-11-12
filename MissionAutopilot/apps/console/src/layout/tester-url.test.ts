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
import { actionTesterUrl } from './tester-url'

describe('actionTesterUrl', () => {
  it('links to the Docker tester port in a production build', () => {
    expect(actionTesterUrl({ protocol: 'http:', hostname: 'plant-pc' }, false)).toBe(
      'http://plant-pc:3004'
    )
  })

  it('links to the tester dev server when the console runs from source', () => {
    expect(actionTesterUrl({ protocol: 'http:', hostname: 'localhost' }, true)).toBe(
      'http://localhost:5180'
    )
  })
})
