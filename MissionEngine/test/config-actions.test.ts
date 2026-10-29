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
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgres://x/y' };
const ACTIONS = 'http://mission-autopilot-server:3002';
const KEY = 'test-key-0123456789abcdef0123456789abcdef';

describe('actions config', () => {
  it('both set gives actions', () => {
    expect(loadConfig({ ...base, MISSION_ACTIONS_URL: ACTIONS, ACTIONS_API_KEY: KEY } as any).actions)
      .toEqual({ url: ACTIONS, key: KEY });
  });
  it('trims the key and url', () => {
    expect(loadConfig({ ...base, MISSION_ACTIONS_URL: ACTIONS + ' ', ACTIONS_API_KEY: KEY + '\r' } as any).actions)
      .toEqual({ url: ACTIONS, key: KEY });
  });
  it('rejects a non-http url', () => {
    expect(() => loadConfig({ ...base, MISSION_ACTIONS_URL: 'ftp://x', ACTIONS_API_KEY: KEY } as any))
      .toThrow('MISSION_ACTIONS_URL must be an http(s) URL');
  });
  it('neither set gives null', () => {
    expect(loadConfig(base as any).actions).toBeNull();
  });
  it('only one set gives null and warns outside tests', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const saved = process.env.VITEST;
    delete process.env.VITEST;
    try {
      const cfg = loadConfig({ ...base, BETTER_AUTH_SECRET: 's', ENGINE_INTERNAL_TOKEN: 't', ACTIONS_API_KEY: KEY } as any);
      expect(cfg.actions).toBeNull();
      expect(warnSpy.mock.calls.some((c) => /MISSION_ACTIONS_URL/.test(String(c[0])))).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.VITEST; else process.env.VITEST = saved;
      warnSpy.mockRestore();
    }
  });
});

describe('production secret policy', () => {
  const prod = { ...base, NODE_ENV: 'production' };
  const GOOD = 'x'.repeat(48);
  it('rejects a placeholder secret', () => {
    expect(() => loadConfig({ ...prod, BETTER_AUTH_SECRET: 'change-me-in-production' } as any))
      .toThrow('BETTER_AUTH_SECRET (MISSION_ENGINE_AUTH_SECRET in .env) is missing');
    expect(() => loadConfig({ ...prod, BETTER_AUTH_SECRET: 'insecure-dev-secret-change-me' } as any)).toThrow(/placeholder/);
  });
  it('rejects a missing or short secret', () => {
    expect(() => loadConfig(prod as any)).toThrow(/shorter than 32/);
    expect(() => loadConfig({ ...prod, BETTER_AUTH_SECRET: 'x'.repeat(31) } as any)).toThrow(/shorter than 32/);
  });
  it('accepts a 48-char secret, trimming CR', () => {
    expect(() => loadConfig({ ...prod, BETTER_AUTH_SECRET: GOOD } as any)).not.toThrow();
    expect(() => loadConfig({ ...prod, BETTER_AUTH_SECRET: 'x'.repeat(32) + '\r' } as any)).not.toThrow();
  });
  it('rejects the dev internal token', () => {
    expect(() => loadConfig({ ...prod, BETTER_AUTH_SECRET: GOOD, ENGINE_INTERNAL_TOKEN: 'mission-internal-dev-token' } as any))
      .toThrow('ENGINE_INTERNAL_TOKEN is the public dev default');
  });
  it('non-production keeps the dev fallback', () => {
    expect(loadConfig({ ...base, BETTER_AUTH_SECRET: 'change-me-in-production' } as any).authSecret).toBe('change-me-in-production');
    expect(loadConfig(base as any).authSecret).toBe('insecure-dev-secret-change-me');
  });
});
