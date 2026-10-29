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
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { readJsonObject } from './json-body';

async function read(body: string): Promise<unknown> {
  const app = new Hono();
  let out: unknown = 'unset';
  app.post('/', async (c) => { out = await readJsonObject(c); return c.json({}); });
  await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  return out;
}

describe('readJsonObject', () => {
  it('returns a plain object', async () => {
    expect(await read('{"a":1}')).toEqual({ a: 1 });
  });
  it.each(['null', '[]', '42', 'not json'])('returns null for %s', async (body) => {
    expect(await read(body)).toBeNull();
  });
});
