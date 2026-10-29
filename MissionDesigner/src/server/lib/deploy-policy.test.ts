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
import { shouldUseSecureCookies, isOriginAllowed } from './deploy-policy'

describe('shouldUseSecureCookies', () => {
  it('true for https base URLs', () => expect(shouldUseSecureCookies('https://demo.example')).toBe(true))
  it('false for http base URLs', () => expect(shouldUseSecureCookies('http://localhost:3000')).toBe(false))
})

describe('isOriginAllowed', () => {
  describe('loopback default (no ALLOWED_ORIGINS configured)', () => {
    it('accepts every loopback host on any port', () => {
      expect(isOriginAllowed('http://localhost:3000', undefined)).toBe(true)
      expect(isOriginAllowed('http://127.0.0.1:3000', undefined)).toBe(true)
      expect(isOriginAllowed('http://[::1]:3000', undefined)).toBe(true)
      expect(isOriginAllowed('http://localhost:5173', undefined)).toBe(true)
    })
    it('rejects non-loopback origins', () => {
      expect(isOriginAllowed('http://192.168.1.50:3000', undefined)).toBe(false)
      expect(isOriginAllowed('https://demo.example', undefined)).toBe(false)
      expect(isOriginAllowed('http://evil.example:3000', undefined)).toBe(false)
      // Defends against a substring/host-confusion bypass.
      expect(isOriginAllowed('http://localhost.evil.com:3000', undefined)).toBe(false)
      expect(isOriginAllowed('http://127.0.0.1.evil.com:3000', undefined)).toBe(false)
    })
    it('rejects an empty origin', () => {
      expect(isOriginAllowed('', undefined)).toBe(false)
    })
  })

  describe('explicit ALLOWED_ORIGINS allowlist', () => {
    it('allows only exact listed origins', () => {
      const env = 'https://workflows.example.com, https://staging.example.com'
      expect(isOriginAllowed('https://workflows.example.com', env)).toBe(true)
      expect(isOriginAllowed('https://staging.example.com', env)).toBe(true)
      expect(isOriginAllowed('https://other.example.com', env)).toBe(false)
    })
    it('does NOT auto-allow loopback once an allowlist is set', () => {
      const env = 'https://workflows.example.com'
      expect(isOriginAllowed('http://127.0.0.1:3000', env)).toBe(false)
      expect(isOriginAllowed('http://localhost:3000', env)).toBe(false)
    })
  })
})
