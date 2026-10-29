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
import { extractTrySpecifications, extractReturnConfig, extractCatchId } from '../step-extractors'

describe('extractTrySpecifications', () => {
  it('undefined when none', () => expect(extractTrySpecifications({})).toBeUndefined())
  it('passes valid rows through verbatim', () =>
    expect(
      extractTrySpecifications({ trySpecifications: [{ mode: 'ERROR', catch_id: 'C', release_on_catch: true }] }),
    ).toEqual([{ mode: 'ERROR', catch_id: 'C', release_on_catch: true }]))
  it('drops invalid modes', () =>
    expect(extractTrySpecifications({ trySpecifications: [{ mode: 'WAT', catch_id: 'C' }] })).toBeUndefined())
})

describe('extractReturnConfig', () => {
  it('ABANDON', () =>
    expect(extractReturnConfig({ returnConfig: { command: 'ABANDON' } })).toEqual({ command: 'ABANDON' }))
  it('RESTART+mode', () =>
    expect(extractReturnConfig({ returnConfig: { command: 'RESTART', restart_mode: 'CLEAN' } })).toEqual({
      command: 'RESTART',
      restart_mode: 'CLEAN',
    }))
  // A RETURN left at the editor's visual default ABANDON never persists returnConfig to node
  // data, so it would export with no return_config and strand the workflow at runtime. Default
  // to ABANDON (the command ReturnConfigEditor already displays) so every RETURN exports a command.
  it('defaults to ABANDON when returnConfig is absent', () =>
    expect(extractReturnConfig({})).toEqual({ command: 'ABANDON' }))
  it('defaults to ABANDON when returnConfig has no command', () =>
    expect(extractReturnConfig({ returnConfig: {} })).toEqual({ command: 'ABANDON' }))
})

describe('extractCatchId', () => {
  it('returns the string', () => expect(extractCatchId({ catchId: 'OvenFailed' })).toBe('OvenFailed'))
})
