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
import { summarizeResource, summarizeRegistryRow } from './resource-summary.js';

test('renders the engine vocabulary for every resource type', () => {
  expect(summarizeResource({ type: 'binary exclusive use', inUse: 0, queued: 0 }))
    .toEqual({ total: 1, inUse: 0, available: 1, queued: 0, state: 'Free' });
  expect(summarizeResource({ type: 'binary exclusive use', inUse: 1, queued: 2 }))
    .toEqual({ total: 1, inUse: 1, available: 0, queued: 2, state: 'In use' });
  expect(summarizeResource({ type: 'binary shared use with pool limits', inUse: 2, useLimit: 3, queued: 0 }))
    .toEqual({ total: 3, inUse: 2, available: 1, queued: 0, state: '2/3 in use' });
  expect(summarizeResource({ type: 'countable use with pool limits', inUse: 2, useLimit: 5, queued: 1 }))
    .toEqual({ total: 5, inUse: 2, available: 3, queued: 1, state: '2/5 in use' });
  expect(summarizeResource({ type: 'named pool', poolSize: 5, available: 4, queued: 0 }))
    .toEqual({ total: 5, inUse: 1, available: 4, queued: 0, state: '4 available, 1 in use' });
  expect(summarizeResource({ type: 'sync', send: 1, receive: 0, sync: 0 }))
    .toEqual({ total: 0, inUse: 0, available: 0, queued: 1, state: 'send:1 recv:0 sync:0' });
});

test('an over-counted binary reads "In use", not "Free"', () => {
  // The engine's counter is typed 0 | 1; a registry row is an int4 and a wedge can leave it at 2.
  expect(summarizeResource({ type: 'binary exclusive use', inUse: 2, queued: 0 }).state).toBe('In use');
});

test('summarizeRegistryRow applies use_limit ?? 1 and derives queue counts by kind', () => {
  const base = { inUse: 0, useLimit: null, poolNames: [], availableNames: [] };
  const q = { acquire: 2, send: 1, receive: 1, sync: 0 };
  expect(summarizeRegistryRow({ ...base, resourceType: 'countable use with pool limits' }, q).state).toBe('0/1 in use');
  expect(summarizeRegistryRow({ ...base, resourceType: 'binary shared use with pool limits', useLimit: 4, inUse: 4 }, q))
    .toMatchObject({ total: 4, available: 0, queued: 2, state: '4/4 in use' });
  expect(summarizeRegistryRow({ ...base, resourceType: 'named pool', poolNames: ['A', 'B', 'C'], availableNames: ['C'] }, q))
    .toMatchObject({ total: 3, inUse: 2, available: 1, queued: 2, state: '1 available, 2 in use' });
  expect(summarizeRegistryRow({ ...base, resourceType: 'sync' }, q))
    .toMatchObject({ queued: 2, state: 'send:1 recv:1 sync:0' });
  expect(summarizeRegistryRow({ ...base, resourceType: 'binary exclusive use', inUse: 1 }, q).state).toBe('In use');
});

test('summarizeRegistryRow refuses a type outside the vocabulary loudly', () => {
  expect(() => summarizeRegistryRow(
    { resourceType: 'quantum', inUse: 0, useLimit: null, poolNames: [], availableNames: [] },
    { acquire: 0, send: 0, receive: 0, sync: 0 },
  )).toThrow(/unknown resource type "quantum"/);
});
