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

import { expect, test, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { healthApp } from '../src/health.js';
import { makeTestDb } from './helpers/db.js';
import { workCenter } from 'mission-control-db/src/db/schema/index';

test('config parses env with spec defaults', () => {
  const cfg = loadConfig({ DATABASE_URL: 'postgres://x/y' } as any);
  expect(cfg).toEqual({
    databaseUrl: 'postgres://x/y', port: 3006, workerConcurrency: 4,
    actionServerAllowlist: [], scriptTimeoutMs: 5000, actionPollSecs: 20, invokeGraceSecs: 60,
    actionFetchTimeoutMs: 10_000,
    propertyWatchEnabled: true, propertyWatchReconcileMs: 5000,
    authSecret: 'insecure-dev-secret-change-me', baseUrl: 'http://127.0.0.1:3006', internalToken: null,
    broker: null, actions: null,
  });
  expect(loadConfig({ DATABASE_URL: 'postgres://x/y', ACTION_SERVER_ALLOWLIST: 'http://a:3002, http://b:3002' } as any).actionServerAllowlist)
    .toEqual(['http://a:3002', 'http://b:3002']);
  expect(() => loadConfig({} as any)).toThrow(/DATABASE_URL/);
});

test('config falls back to the dev auth secret and warns outside tests', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const savedVitestFlag = process.env.VITEST;
  delete process.env.VITEST; // simulate a real (non-test) boot so the warn guard actually fires
  try {
    // ENGINE_INTERNAL_TOKEN is also unset here, so its own boot warning fires alongside
    // BETTER_AUTH_SECRET's — assert both, in the order loadConfig emits them.
    const cfg = loadConfig({ DATABASE_URL: 'postgres://x/y' } as any);
    expect(cfg.authSecret).toBe('insecure-dev-secret-change-me');
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0][0]).toMatch(/BETTER_AUTH_SECRET/);
    expect(warnSpy.mock.calls[1][0]).toMatch(/ENGINE_INTERNAL_TOKEN/);
  } finally {
    if (savedVitestFlag === undefined) delete process.env.VITEST; else process.env.VITEST = savedVitestFlag;
    warnSpy.mockRestore();
  }
});

test('config treats an empty BETTER_AUTH_SECRET the same as unset (compose\'s ${VAR:-} passthrough)', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const savedVitestFlag = process.env.VITEST;
  delete process.env.VITEST;
  try {
    // ENGINE_INTERNAL_TOKEN is set here, so only the BETTER_AUTH_SECRET warning fires.
    const cfg = loadConfig({ DATABASE_URL: 'postgres://x/y', BETTER_AUTH_SECRET: '', ENGINE_INTERNAL_TOKEN: 'tok' } as any);
    expect(cfg.authSecret).toBe('insecure-dev-secret-change-me');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/BETTER_AUTH_SECRET/);
  } finally {
    if (savedVitestFlag === undefined) delete process.env.VITEST; else process.env.VITEST = savedVitestFlag;
    warnSpy.mockRestore();
  }
});

test('config uses a real auth secret without warning', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const cfg = loadConfig({ DATABASE_URL: 'postgres://x/y', BETTER_AUTH_SECRET: 'a-real-secret-value', ENGINE_INTERNAL_TOKEN: 'tok' } as any);
  expect(cfg.authSecret).toBe('a-real-secret-value');
  expect(warnSpy).not.toHaveBeenCalled();
  warnSpy.mockRestore();
});

test('config falls back to no internal token and warns once outside tests', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const savedVitestFlag = process.env.VITEST;
  delete process.env.VITEST; // simulate a real (non-test) boot so the warn guard actually fires
  try {
    // BETTER_AUTH_SECRET is set here, so only the ENGINE_INTERNAL_TOKEN warning fires.
    const cfg = loadConfig({ DATABASE_URL: 'postgres://x/y', BETTER_AUTH_SECRET: 'a-real-secret-value' } as any);
    expect(cfg.internalToken).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/ENGINE_INTERNAL_TOKEN/);
  } finally {
    if (savedVitestFlag === undefined) delete process.env.VITEST; else process.env.VITEST = savedVitestFlag;
    warnSpy.mockRestore();
  }
});

test('config uses a real internal token without warning', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const cfg = loadConfig({ DATABASE_URL: 'postgres://x/y', BETTER_AUTH_SECRET: 'a-real-secret-value', ENGINE_INTERNAL_TOKEN: 'tok' } as any);
  expect(cfg.internalToken).toBe('tok');
  expect(warnSpy).not.toHaveBeenCalled();
  warnSpy.mockRestore();
});

test('config refuses the public dev internal token when bound beyond loopback', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const savedVitestFlag = process.env.VITEST;
  delete process.env.VITEST; // simulate a real (non-test) boot so the error log actually fires
  try {
    const cfg = loadConfig({
      DATABASE_URL: 'postgres://x/y', BETTER_AUTH_SECRET: 'a-real-secret-value',
      ENGINE_INTERNAL_TOKEN: 'mission-internal-dev-token', MISSION_ENGINE_BIND: '0.0.0.0',
    } as any);
    expect(cfg.internalToken).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/ENGINE_INTERNAL_TOKEN/);
  } finally {
    if (savedVitestFlag === undefined) delete process.env.VITEST; else process.env.VITEST = savedVitestFlag;
    errorSpy.mockRestore();
  }
});

test('config refuses the public dev internal token when ENGINE_BASE_URL is non-loopback', () => {
  // Covers a proxy/real deployment where the bind stays loopback but the engine is
  // reachable at a real address — the published dev token must never gate /internal/* there.
  const cfg = loadConfig({
    DATABASE_URL: 'postgres://x/y', BETTER_AUTH_SECRET: 'a-real-secret-value',
    ENGINE_INTERNAL_TOKEN: 'mission-internal-dev-token', ENGINE_BASE_URL: 'http://192.168.1.50:3006',
  } as any);
  expect(cfg.internalToken).toBeNull();
});

test('config accepts the dev internal token on the loopback-only dev stack', () => {
  const base = { DATABASE_URL: 'postgres://x/y', BETTER_AUTH_SECRET: 'a-real-secret-value', ENGINE_INTERNAL_TOKEN: 'mission-internal-dev-token' };
  expect(loadConfig({ ...base } as any).internalToken).toBe('mission-internal-dev-token');
  expect(loadConfig({ ...base, MISSION_ENGINE_BIND: '127.0.0.1' } as any).internalToken).toBe('mission-internal-dev-token');
  expect(loadConfig({ ...base, MISSION_ENGINE_BIND: 'localhost' } as any).internalToken).toBe('mission-internal-dev-token');
});

test('config accepts a real internal token on a non-loopback bind', () => {
  const cfg = loadConfig({
    DATABASE_URL: 'postgres://x/y', BETTER_AUTH_SECRET: 'a-real-secret-value',
    ENGINE_INTERNAL_TOKEN: 'a-real-random-token', MISSION_ENGINE_BIND: '0.0.0.0', ENGINE_BASE_URL: 'http://192.168.1.50:3006',
  } as any);
  expect(cfg.internalToken).toBe('a-real-random-token');
});

test('health endpoint responds', async () => {
  const res = await healthApp.request('/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
});

test('test db migrates the shared schema (18 migrations)', async () => {
  const { db, close } = await makeTestDb();
  const [wc] = await db.insert(workCenter).values({ name: 'wc' }).returning();
  expect(wc.finishedRetentionSecs).toBe(3600); // proves 0018 replayed
  await close();
});

test('config: PROPERTY_WATCH_ENABLED and PROPERTY_WATCH_RECONCILE_MS (spec 2026-09-14 §4.5/§4.7)', () => {
  const base = { DATABASE_URL: 'postgres://x/y' };
  expect(loadConfig(base as any).propertyWatchEnabled).toBe(true);
  expect(loadConfig(base as any).propertyWatchReconcileMs).toBe(5000);
  expect(loadConfig({ ...base, PROPERTY_WATCH_ENABLED: 'false' } as any).propertyWatchEnabled).toBe(false);
  expect(loadConfig({ ...base, PROPERTY_WATCH_ENABLED: '0' } as any).propertyWatchEnabled).toBe(false);
  expect(loadConfig({ ...base, PROPERTY_WATCH_ENABLED: 'off' } as any).propertyWatchEnabled).toBe(false);
  expect(loadConfig({ ...base, PROPERTY_WATCH_ENABLED: 'true' } as any).propertyWatchEnabled).toBe(true);
  // compose's `${VAR:-true}` passthrough style can yield an empty string — treated as unset.
  expect(loadConfig({ ...base, PROPERTY_WATCH_ENABLED: '' } as any).propertyWatchEnabled).toBe(true);
  expect(loadConfig({ ...base, PROPERTY_WATCH_RECONCILE_MS: '250' } as any).propertyWatchReconcileMs).toBe(250);
  expect(loadConfig({ ...base, PROPERTY_WATCH_RECONCILE_MS: 'nope' } as any).propertyWatchReconcileMs).toBe(5000);
});
