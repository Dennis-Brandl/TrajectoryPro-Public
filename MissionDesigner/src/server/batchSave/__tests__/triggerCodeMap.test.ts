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

// @vitest-environment node

import { describe, it, expect, beforeAll } from 'vitest'
import { bootstrapDatabase, rawQuery } from '../../lib/db'

let mapTriggerMessageToCode: (msg: string) => any

let TRIGGER_CODE_MAP: Record<string, any>

beforeAll(async () => {
  await bootstrapDatabase()
  const mod = await import('../triggerCodeMap')
  mapTriggerMessageToCode = mod.mapTriggerMessageToCode
  TRIGGER_CODE_MAP = mod.TRIGGER_CODE_MAP
})

describe('triggerCodeMap (§2.4)', () => {
  it('every PL/pgSQL trigger RAISE EXCEPTION message has a mapped code', async () => {
    // Query all trigger function bodies from pg_proc. Trigger functions installed
    // by bootstrapDatabase() are named trg_*. Extract RAISE EXCEPTION '...' strings.
    const rows = await rawQuery<{ prosrc: string }>(`SELECT prosrc FROM pg_proc WHERE proname LIKE 'trg_%'`)
    const messages: string[] = []
    for (const { prosrc } of rows) {
      const re = /RAISE\s+EXCEPTION\s+'([^']+)'/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(prosrc)) !== null) messages.push(m[1])
    }
    const missing: string[] = []
    for (const msg of messages) {
      if (mapTriggerMessageToCode(msg) === null) missing.push(msg)
    }
    expect(missing).toEqual([])
  })

  it('returns null for unknown messages', () => {
    expect(mapTriggerMessageToCode('a brand new RAISE we forgot about')).toBeNull()
  })

  it('TRIGGER_CODE_MAP is non-empty', () => {
    expect(Object.keys(TRIGGER_CODE_MAP).length).toBeGreaterThan(0)
  })
})
