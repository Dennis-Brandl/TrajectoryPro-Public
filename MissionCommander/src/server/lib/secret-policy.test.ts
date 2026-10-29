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
import { describe, expect, it } from 'vitest';
import { secretProblems } from './secret-policy';

const GOOD = 'a1b2c3d4'.repeat(8);
const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;

describe('secretProblems', () => {
  it.each(['insecure-dev-secret-change-me', 'change-me-in-production', 'mission-internal-dev-token'])('flags placeholder %s', (p) => {
    expect(secretProblems({ ...prod, BETTER_AUTH_SECRET: p })).toEqual(['BETTER_AUTH_SECRET is missing, a placeholder, or shorter than 32 characters.']);
  });
  it('flags missing and short secrets', () => {
    expect(secretProblems(prod)).toHaveLength(1);
    expect(secretProblems({ ...prod, BETTER_AUTH_SECRET: 'x'.repeat(31) })).toHaveLength(1);
  });
  it('accepts a 64-hex secret', () => {
    expect(secretProblems({ ...prod, BETTER_AUTH_SECRET: GOOD })).toEqual([]);
  });
  it('trims a trailing CR', () => {
    expect(secretProblems({ ...prod, BETTER_AUTH_SECRET: 'x'.repeat(32) + '\r' })).toEqual([]);
  });
  it('is silent outside production', () => {
    expect(secretProblems({ NODE_ENV: 'development' })).toEqual([]);
    expect(secretProblems({})).toEqual([]);
  });
  it('flags the dev internal token and short tokens', () => {
    const env = { ...prod, BETTER_AUTH_SECRET: GOOD };
    expect(secretProblems({ ...env, ENGINE_INTERNAL_TOKEN: 'mission-internal-dev-token' })).toEqual(['ENGINE_INTERNAL_TOKEN is the public dev default or shorter than 32 characters.']);
    expect(secretProblems({ ...env, ENGINE_INTERNAL_TOKEN: 'short' })).toHaveLength(1);
    expect(secretProblems({ ...env, ENGINE_INTERNAL_TOKEN: GOOD })).toEqual([]);
  });
});
