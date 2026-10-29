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

import { describe, it, expect, beforeEach } from 'vitest'
import { cleanupMutex } from '../mutex'

describe('cleanupMutex', () => {
  beforeEach(() => cleanupMutex.release())

  it('first acquire succeeds, second fails', () => {
    expect(cleanupMutex.acquire()).toBe(true)
    expect(cleanupMutex.acquire()).toBe(false)
  })

  it('release allows a new acquire', () => {
    cleanupMutex.acquire()
    cleanupMutex.release()
    expect(cleanupMutex.acquire()).toBe(true)
  })

  it('release is idempotent', () => {
    cleanupMutex.release()
    cleanupMutex.release()
    expect(cleanupMutex.acquire()).toBe(true)
  })
})
