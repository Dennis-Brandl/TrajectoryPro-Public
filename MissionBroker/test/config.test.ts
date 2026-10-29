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

import { expect, test } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgres://x/y', MISSION_BROKER_TOKEN: 'x'.repeat(32) };

test('retention defaults to 14 days', () => {
  expect(loadConfig({ ...base }).retentionDays).toBe(14);
  expect(loadConfig({ ...base, BROKER_RETENTION_DAYS: '' }).retentionDays).toBe(14);
});

test('BROKER_RETENTION_DAYS=7 → 7', () => {
  expect(loadConfig({ ...base, BROKER_RETENTION_DAYS: '7' }).retentionDays).toBe(7);
});

test('0, -1, 1.5 and abc throw /BROKER_RETENTION_DAYS/', () => {
  for (const v of ['0', '-1', '1.5', 'abc']) {
    expect(() => loadConfig({ ...base, BROKER_RETENTION_DAYS: v })).toThrow(/BROKER_RETENTION_DAYS/);
  }
});

test('refuses to start without a token or with 31 characters', () => {
  expect(() => loadConfig({ DATABASE_URL: 'postgres://x/y' })).toThrow(/MISSION_BROKER_TOKEN/);
  expect(() => loadConfig({ DATABASE_URL: 'postgres://x/y', MISSION_BROKER_TOKEN: 'x'.repeat(31) })).toThrow(/MISSION_BROKER_TOKEN/);
});

test('accepts 32 characters', () => {
  expect(loadConfig({ ...base }).token).toBe('x'.repeat(32));
});

test('trims the token (a CR or trailing space from .env)', () => {
  expect(loadConfig({ ...base, MISSION_BROKER_TOKEN: 'x'.repeat(32) + '\r' }).token).toBe('x'.repeat(32));
});

test('CORS origins default to the Tester on :3004; a custom list is trimmed', () => {
  expect(loadConfig({ ...base }).corsOrigins).toEqual(['http://localhost:3004', 'http://127.0.0.1:3004']);
  expect(loadConfig({ ...base, BROKER_CORS_ORIGINS: ' http://a.example , ,http://b.example ' }).corsOrigins).toEqual(['http://a.example', 'http://b.example']);
});
