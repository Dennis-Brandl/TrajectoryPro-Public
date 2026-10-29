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
import { extractScriptConfig } from '@/lib/packageFormat/step-extractors'

describe('extractScriptConfig — repeat (spec 2026-10-13 §6.1)', () => {
  it('a one-shot script exports exactly as before, even with leftover repeat fields', () => {
    expect(extractScriptConfig({ scriptSource: 'return true;', scriptLanguage: 'javascript' })).toEqual({
      language: 'javascript',
      source: 'return true;',
    })
    expect(
      extractScriptConfig({
        scriptSource: 'x',
        scriptRepeat: false,
        scriptCycleSeconds: 9,
        scriptTimeLimit: { minutes: 4 },
      }),
    ).toEqual({ language: undefined, source: 'x' })
    expect(extractScriptConfig({})).toBeUndefined()
  })
  it('repeat with no time limit exports the cycle only (blank boxes = no limit)', () => {
    expect(extractScriptConfig({ scriptSource: 'return false;', scriptRepeat: true })).toEqual({
      language: undefined,
      source: 'return false;',
      repeat: { cycle_seconds: 5 },
    })
    expect(
      extractScriptConfig({
        scriptSource: 'x',
        scriptRepeat: true,
        scriptCycleSeconds: 2,
        scriptTimeLimit: {},
        scriptOnTimeLimit: 'complete',
      })?.repeat,
    ).toEqual({ cycle_seconds: 2 })
  })
  it('a time limit exports its seconds and what happens at it', () => {
    expect(
      extractScriptConfig({ scriptSource: 'x', scriptRepeat: true, scriptTimeLimit: { hours: 2 } })?.repeat,
    ).toEqual({ cycle_seconds: 5, time_limit_seconds: 7200, on_time_limit: 'error' })
    expect(
      extractScriptConfig({
        scriptSource: 'x',
        scriptRepeat: true,
        scriptTimeLimit: { minutes: 1 },
        scriptOnTimeLimit: 'complete',
      })?.repeat,
    ).toEqual({ cycle_seconds: 5, time_limit_seconds: 60, on_time_limit: 'complete' })
  })
})
