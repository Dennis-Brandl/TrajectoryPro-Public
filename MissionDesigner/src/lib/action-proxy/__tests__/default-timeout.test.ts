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
import { parseTimeLimitSeconds, formatTimeLimitSeconds, setProxyTimeout, proxyTimeoutMs } from '../default-timeout'

describe('parseTimeLimitSeconds', () => {
  it('treats blank as no limit', () => {
    expect(parseTimeLimitSeconds('')).toEqual({ ok: true, timeoutMs: undefined })
    expect(parseTimeLimitSeconds('   ')).toEqual({ ok: true, timeoutMs: undefined })
  })
  it('converts whole seconds to ms, trimming', () => {
    expect(parseTimeLimitSeconds('45')).toEqual({ ok: true, timeoutMs: 45000 })
    expect(parseTimeLimitSeconds(' 45 ')).toEqual({ ok: true, timeoutMs: 45000 })
    expect(parseTimeLimitSeconds('1')).toEqual({ ok: true, timeoutMs: 1000 })
  })
  it.each(['0', '-3', '1.5', 'abc', '1e3'])('rejects %s', (t) => {
    expect(parseTimeLimitSeconds(t)).toEqual({ ok: false })
  })
})

describe('formatTimeLimitSeconds', () => {
  it('formats', () => {
    expect(formatTimeLimitSeconds(undefined)).toBe('')
    expect(formatTimeLimitSeconds(30000)).toBe('30')
  })
})

describe('setProxyTimeout', () => {
  it('removes the key when undefined', () => {
    const cfg = { action_oid: 'a', environment_oid: 'e', timeout_ms: 5 }
    const out = setProxyTimeout(cfg, undefined)
    expect('timeout_ms' in out).toBe(false)
    expect(out.action_oid).toBe('a')
  })
  it('sets the key', () => {
    expect(setProxyTimeout({ timeout_ms: 1 }, 7).timeout_ms).toBe(7)
  })
})

describe('proxyTimeoutMs', () => {
  it('passes the authored value through, no default', () => {
    expect(proxyTimeoutMs(undefined)).toBeUndefined()
    expect(proxyTimeoutMs(30000)).toBe(30000)
  })
})
