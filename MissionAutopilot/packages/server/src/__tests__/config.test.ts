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
import { allowedHosts, readApiKey } from '../config.js'

describe('readApiKey', () => {
  it('returns null when missing', () => {
    expect(readApiKey({})).toBeNull()
  })

  it('returns null for a key shorter than 32 characters', () => {
    expect(readApiKey({ ACTIONS_API_KEY: 'a'.repeat(31) })).toBeNull()
  })

  it('trims spaces and a trailing CR before the length check', () => {
    const key = 'k'.repeat(32)
    expect(readApiKey({ ACTIONS_API_KEY: `  ${key}\r` })).toBe(key)
    expect(readApiKey({ ACTIONS_API_KEY: `${'k'.repeat(31)} \r` })).toBeNull()
  })
})

describe('allowedHosts', () => {
  it('includes defaults, the fleet host and ACTIONS_ALLOWED_HOSTS', () => {
    const hosts = allowedHosts({
      FLEET_BASE_URL: 'http://fleet.lan:3002',
      ACTIONS_ALLOWED_HOSTS: ' A.example , b.example',
    })
    for (const h of [
      'fleet.lan',
      'a.example',
      'b.example',
      'mission-autopilot-server',
      'localhost',
    ]) {
      expect(hosts.has(h)).toBe(true)
    }
  })
})
