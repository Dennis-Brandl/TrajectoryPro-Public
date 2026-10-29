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
import { NODE_TYPE_TO_STEP_TYPE } from '../export-types'
import { STEP_TYPE_TO_NODE_TYPE } from '../../import/type-mapping'

describe('TRY/CATCH/RETURN type mappings', () => {
  it('maps catch ↔ CATCH and return ↔ RETURN', () => {
    expect(NODE_TYPE_TO_STEP_TYPE.catch).toBe('CATCH')
    expect(NODE_TYPE_TO_STEP_TYPE.return).toBe('RETURN')
    expect(STEP_TYPE_TO_NODE_TYPE.CATCH).toBe('catch')
    expect(STEP_TYPE_TO_NODE_TYPE.RETURN).toBe('return')
  })
})
