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
import { redactUrl } from '../log-redact.js'

describe('redactUrl', () => {
  it('hides the token value but keeps other parameters', () => {
    const key = 'test-key-0123456789abcdef0123456789abcdef'
    const out = redactUrl(`/trajectory/v1/instances/abc/events?token=${key}&x=1`)
    expect(out).not.toContain(key)
    expect(out).toContain('x=1')
    expect(out).toBe('/trajectory/v1/instances/abc/events?token=[redacted]&x=1')
  })

  it('handles token not first and urls without a query', () => {
    expect(redactUrl('/a?x=1&token=abc')).toBe('/a?x=1&token=[redacted]')
    expect(redactUrl('/a')).toBe('/a')
  })
})
