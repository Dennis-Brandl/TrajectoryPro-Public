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
import express from 'express'
import cors from 'cors'
import request from 'supertest'
import { isOriginAllowed } from '../config.js'

describe('isOriginAllowed', () => {
  it('allows requests with no Origin (same-origin / non-browser)', () => {
    expect(isOriginAllowed(undefined, undefined)).toBe(true)
  })

  it('allows loopback origins by default', () => {
    expect(isOriginAllowed('http://localhost:3004', undefined)).toBe(true)
    expect(isOriginAllowed('http://127.0.0.1:3000', undefined)).toBe(true)
  })

  it('blocks arbitrary internet origins by default', () => {
    expect(isOriginAllowed('https://evil.example', undefined)).toBe(false)
  })

  it('honours an explicit ACTIONS_ALLOWED_ORIGINS allowlist', () => {
    expect(
      isOriginAllowed('https://app.example', 'https://app.example, https://other.example')
    ).toBe(true)
    expect(isOriginAllowed('https://evil.example', 'https://app.example')).toBe(false)
  })

  it('keeps loopback console origins allowed when an allowlist is set', () => {
    for (const o of [
      'http://localhost:3003',
      'http://127.0.0.1:3003',
      'http://localhost:3004',
      'http://[::1]:3003',
    ]) {
      expect(isOriginAllowed(o, 'https://app.example')).toBe(true)
    }
  })
})

describe('cors middleware integration', () => {
  function appWith(allowedEnv: string | undefined) {
    const app = express()
    app.use(cors({ origin: (origin, cb) => cb(null, isOriginAllowed(origin, allowedEnv)) }))
    app.get('/ping', (_req, res) => {
      res.json({ ok: true })
    })
    return app
  }

  it('does not echo Access-Control-Allow-Origin for an arbitrary origin', async () => {
    const res = await request(appWith(undefined)).get('/ping').set('Origin', 'https://evil.example')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('reflects a loopback origin', async () => {
    const res = await request(appWith(undefined))
      .get('/ping')
      .set('Origin', 'http://localhost:3004')
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3004')
  })
})
