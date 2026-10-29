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
//
// createWakeListener: one reconnect per dead client, and a late error on a discarded client
// must not become an unhandled 'error' event (which would exit the engine process).
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({
  clients: [] as unknown[],
  connectImpl: { fn: (): Promise<void> => Promise.resolve() },
}));

vi.mock('pg', async () => {
  const { EventEmitter: EE } = await import('node:events');
  class FakeClient extends EE {
    connect = vi.fn(() => h.connectImpl.fn());
    query = vi.fn(() => Promise.resolve());
    end = vi.fn(() => Promise.resolve());
    constructor() { super(); h.clients.push(this); }
  }
  return { default: { Client: FakeClient } };
});

import { createWakeListener } from '../src/wake.js';

beforeEach(() => { vi.useFakeTimers(); h.clients.length = 0; h.connectImpl.fn = () => Promise.resolve(); });
afterEach(() => { vi.useRealTimers(); });

test('error then end schedules exactly one reconnect', async () => {
  const handle = createWakeListener('postgres://x', () => {});
  await vi.advanceTimersByTimeAsync(0);
  expect(h.clients).toHaveLength(1);
  const c = h.clients[0] as EventEmitter;
  c.emit('error', new Error('boom'));
  c.emit('end');
  await vi.advanceTimersByTimeAsync(6000);
  expect(h.clients).toHaveLength(2);
  handle.stop();
});

test('connect failure then end schedules one reconnect', async () => {
  h.connectImpl.fn = () => Promise.reject(new Error('refused'));
  const handle = createWakeListener('postgres://x', () => {});
  const c = h.clients[0] as EventEmitter;
  c.emit('end');
  await vi.advanceTimersByTimeAsync(0); // the rejected connect() lands too
  h.connectImpl.fn = () => Promise.resolve();
  await vi.advanceTimersByTimeAsync(6000);
  expect(h.clients).toHaveLength(2);
  handle.stop();
});

test('a late error on the discarded client does not throw', async () => {
  const handle = createWakeListener('postgres://x', () => {});
  await vi.advanceTimersByTimeAsync(0);
  const old = h.clients[0] as EventEmitter;
  old.emit('end');
  await vi.advanceTimersByTimeAsync(6000);
  expect(h.clients).toHaveLength(2);
  expect(() => old.emit('error', new Error('late'))).not.toThrow();
  handle.stop();
});
