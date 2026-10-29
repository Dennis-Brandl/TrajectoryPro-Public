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
// Transcribed from the reference repo's engines/web/src/resource-manager.test.ts and
// resource-helpers.test.ts (node:test/node:assert -> vitest), per task-8-brief.md's
// "adapting imports" instruction. The toJSON/fromJSON round-trip tests (including the
// mid-contention round-trip) are new, per the brief's Step 1 required-coverage list —
// the reference InMemoryResourceManager has no serialization.
import { expect, test, describe } from 'vitest';
import { InMemoryResourceManager, splitResourceCommands, sortActivationCommands } from '../src/core/resources.js';
import type { ResourceCommandSpecification } from '../src/spec/types.js';

// Resource manager model: pools are pure state (counts or named lists).
// Acquire decrements; Release increments. The manager does NOT track
// who holds what — workflow author is responsible for releasing the right
// name/amount. Queue entries identify waiters by stepOid only (for grant
// routing on release).

describe('InMemoryResourceManager — binary exclusive use', () => {
  function makeManager() {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Lock', { name: 'Lock', resource_type: 'binary exclusive use' }, 'wf1');
    return mgr;
  }

  test('acquire succeeds when resource is free', () => {
    const mgr = makeManager();
    const result = mgr.acquire('wf1:Lock', 's1');
    expect(result).toEqual({ granted: true });
  });

  test('acquire fails when resource is held', () => {
    const mgr = makeManager();
    mgr.acquire('wf1:Lock', 's1');
    const result = mgr.acquire('wf1:Lock', 's2');
    expect(result).toEqual({ granted: false });
  });

  test('release frees the resource for next acquirer', () => {
    const mgr = makeManager();
    mgr.acquire('wf1:Lock', 's1');
    mgr.release('wf1:Lock');
    const result = mgr.acquire('wf1:Lock', 's2');
    expect(result).toEqual({ granted: true });
  });

  test('queued request is granted after release via flushGranted', () => {
    const mgr = makeManager();
    mgr.acquire('wf1:Lock', 's1');
    mgr.acquire('wf1:Lock', 's2'); // queued
    mgr.release('wf1:Lock');
    const granted = mgr.flushGranted();
    expect(granted.length).toBe(1);
    expect(granted[0].stepOid).toBe('s2');
    expect(granted[0].resourceKey).toBe('wf1:Lock');
  });

  test('release of free resource returns false (no-op)', () => {
    const mgr = makeManager();
    expect(mgr.release('wf1:Lock')).toBe(false);
  });

  test('double release after acquire is no-op on the second call', () => {
    const mgr = makeManager();
    mgr.acquire('wf1:Lock', 's1');
    expect(mgr.release('wf1:Lock')).toBe(true);
    expect(mgr.release('wf1:Lock')).toBe(false); // already free
  });

  test('throws on unregistered resource', () => {
    const mgr = new InMemoryResourceManager();
    expect(() => mgr.acquire('NoSuch', 's1')).toThrow(/not registered/);
  });

  test('FIFO queue order', () => {
    const mgr = makeManager();
    mgr.acquire('wf1:Lock', 's1');
    mgr.acquire('wf1:Lock', 's2'); // queued
    mgr.acquire('wf1:Lock', 's3'); // queued
    mgr.release('wf1:Lock');
    const g1 = mgr.flushGranted();
    expect(g1.length).toBe(1);
    expect(g1[0].stepOid).toBe('s2');
    mgr.release('wf1:Lock');
    const g2 = mgr.flushGranted();
    expect(g2.length).toBe(1);
    expect(g2[0].stepOid).toBe('s3');
  });
});

describe('InMemoryResourceManager — binary shared use with pool limits', () => {
  function makeManager() {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Pool', { name: 'Pool', resource_type: 'binary shared use with pool limits', use_limit: 2 }, 'wf1');
    return mgr;
  }

  test('multiple acquires up to use_limit succeed', () => {
    const mgr = makeManager();
    expect(mgr.acquire('wf1:Pool', 's1')).toEqual({ granted: true });
    expect(mgr.acquire('wf1:Pool', 's2')).toEqual({ granted: true });
  });

  test('acquire beyond use_limit fails', () => {
    const mgr = makeManager();
    mgr.acquire('wf1:Pool', 's1');
    mgr.acquire('wf1:Pool', 's2');
    expect(mgr.acquire('wf1:Pool', 's3')).toEqual({ granted: false });
  });

  test('release opens slot for queued request', () => {
    const mgr = makeManager();
    mgr.acquire('wf1:Pool', 's1');
    mgr.acquire('wf1:Pool', 's2');
    mgr.acquire('wf1:Pool', 's3'); // queued
    mgr.release('wf1:Pool');
    const granted = mgr.flushGranted();
    expect(granted.length).toBe(1);
    expect(granted[0].stepOid).toBe('s3');
  });
});

describe('InMemoryResourceManager — countable use with pool limits', () => {
  function makeManager() {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Slots', { name: 'Slots', resource_type: 'countable use with pool limits', use_limit: 10 }, 'wf1');
    return mgr;
  }

  test('acquire amount within limit', () => {
    const mgr = makeManager();
    expect(mgr.acquireAmount('wf1:Slots', 's1', 5)).toEqual({ granted: true });
    expect(mgr.acquireAmount('wf1:Slots', 's2', 5)).toEqual({ granted: true });
  });

  test('acquire amount exceeding limit fails', () => {
    const mgr = makeManager();
    mgr.acquireAmount('wf1:Slots', 's1', 8);
    expect(mgr.acquireAmount('wf1:Slots', 's2', 5)).toEqual({ granted: false });
  });

  test('strict FIFO: large request at head blocks smaller request behind', () => {
    const mgr = makeManager();
    mgr.acquireAmount('wf1:Slots', 's1', 8);
    mgr.acquireAmount('wf1:Slots', 's2', 5); // queued
    mgr.acquireAmount('wf1:Slots', 's3', 1); // queued behind s2
    mgr.releaseAmount('wf1:Slots', 3); // now 5 free — s2 can be served
    const granted = mgr.flushGranted();
    expect(granted.length).toBe(1);
    expect(granted[0].stepOid).toBe('s2');
    // s3 still queued
    expect(mgr.flushGranted()).toEqual([]);
  });

  test('releaseAmount clamps inUse at zero (defensive bound on author error)', () => {
    const mgr = makeManager();
    mgr.acquireAmount('wf1:Slots', 's1', 3);
    // Author releases more than they acquired — silently clamped to 0.
    mgr.releaseAmount('wf1:Slots', 5);
    // Pool now fully free; an 8-amount acquire succeeds.
    expect(mgr.acquireAmount('wf1:Slots', 's2', 8)).toEqual({ granted: true });
  });

  test('multiple acquires + releases of arbitrary amounts (no per-holder tracking)', () => {
    const mgr = makeManager();
    mgr.acquireAmount('wf1:Slots', 's1', 4);
    mgr.acquireAmount('wf1:Slots', 's2', 3);
    // Pool: 7/10 in use. Release 4 (whichever amount author chose).
    mgr.releaseAmount('wf1:Slots', 4);
    // Pool: 3/10 in use. Now 7 free.
    expect(mgr.acquireAmount('wf1:Slots', 's3', 7)).toEqual({ granted: true });
  });
});

describe('InMemoryResourceManager — named pool', () => {
  function makeManager() {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Docks', {
      name: 'Docks',
      resource_type: 'named pool',
      names: ['Dock 1', 'Dock 2', 'Dock 3'],
    }, 'wf1');
    return mgr;
  }

  test('acquire assigns any available name', () => {
    const mgr = makeManager();
    const result = mgr.acquireNamed('wf1:Docks', 's1');
    expect(result.granted).toBe(true);
    expect('name' in result && result.name).toBeTruthy();
  });

  test('exhaust pool then queue', () => {
    const mgr = makeManager();
    mgr.acquireNamed('wf1:Docks', 's1');
    mgr.acquireNamed('wf1:Docks', 's2');
    mgr.acquireNamed('wf1:Docks', 's3');
    expect(mgr.acquireNamed('wf1:Docks', 's4')).toEqual({ granted: false });
  });

  test('release returns name to pool', () => {
    const mgr = makeManager();
    const r1 = mgr.acquireNamed('wf1:Docks', 's1');
    if (!r1.granted || !r1.name) throw new Error('expected grant with name');
    expect(mgr.releaseNamed('wf1:Docks', r1.name)).toBe(true);
    const r2 = mgr.acquireNamed('wf1:Docks', 's2');
    expect(r2.granted).toBe(true);
  });

  test('multi-acquire + release of arbitrary names (no holder tracking)', () => {
    // The bug that motivated the model change: hold multiple names, release out of order.
    const mgr = makeManager();
    const r1 = mgr.acquireNamed('wf1:Docks', 's1');
    const r2 = mgr.acquireNamed('wf1:Docks', 's2');
    const r3 = mgr.acquireNamed('wf1:Docks', 's3');
    if (!r1.granted || !r1.name || !r2.granted || !r2.name || !r3.granted || !r3.name) {
      throw new Error('expected all three to be granted with names');
    }
    // Release the SECOND-acquired name (out of order). Author tells us which name.
    expect(mgr.releaseNamed('wf1:Docks', r2.name)).toBe(true);
    // Pool now has r2.name available; new acquire should grant it.
    const r4 = mgr.acquireNamed('wf1:Docks', 's4');
    expect(r4.granted && r4.name === r2.name).toBe(true);
  });

  test('double-release of the same name is silently ignored', () => {
    const mgr = makeManager();
    const r1 = mgr.acquireNamed('wf1:Docks', 's1');
    if (!r1.granted || !r1.name) throw new Error('expected grant with name');
    expect(mgr.releaseNamed('wf1:Docks', r1.name)).toBe(true);
    expect(mgr.releaseNamed('wf1:Docks', r1.name)).toBe(false); // already in pool
  });

  test('release of a name that was never part of the pool is silently ignored', () => {
    const mgr = makeManager();
    expect(mgr.releaseNamed('wf1:Docks', 'Phantom Dock')).toBe(false);
  });

  test('release grants to queued request and propagates name via pendingNamedAssignment', () => {
    const mgr = makeManager();
    const r1 = mgr.acquireNamed('wf1:Docks', 's1');
    mgr.acquireNamed('wf1:Docks', 's2');
    mgr.acquireNamed('wf1:Docks', 's3');
    mgr.acquireNamed('wf1:Docks', 's4'); // queued
    if (!r1.granted || !r1.name) throw new Error('expected grant with name');
    mgr.releaseNamed('wf1:Docks', r1.name);
    const granted = mgr.flushGranted();
    expect(granted.length).toBe(1);
    expect(granted[0].stepOid).toBe('s4');
    // The reserved name is delivered to the engine via consumePendingNamedAssignment.
    const assignedName = mgr.consumePendingNamedAssignment('s4');
    expect(assignedName).toBe(r1.name);
    // Consumed once — second consume returns undefined.
    expect(mgr.consumePendingNamedAssignment('s4')).toBeUndefined();
  });
});

describe('InMemoryResourceManager — sync', () => {
  function makeManager() {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Chan', { name: 'Chan', resource_type: 'sync' }, 'wf1');
    return mgr;
  }

  test('send then receive: sender waits, receiver picks up data', () => {
    const mgr = makeManager();
    const sendResult = mgr.send('wf1:Chan', 'sender-step', 'hello');
    expect(sendResult).toEqual({ ready: false });
    const recvResult = mgr.receive('wf1:Chan', 'receiver-step');
    expect(recvResult).toEqual({ available: true, data: 'hello' });
    const granted = mgr.flushGranted();
    expect(granted.some(g => g.stepOid === 'sender-step')).toBe(true);
  });

  test('receive then send: receiver waits, sender delivers', () => {
    const mgr = makeManager();
    const recvResult = mgr.receive('wf1:Chan', 'receiver-step');
    expect(recvResult).toEqual({ available: false });
    const sendResult = mgr.send('wf1:Chan', 'sender-step', 'world');
    expect(sendResult).toEqual({ ready: true });
    const granted = mgr.flushGranted();
    expect(granted.some(g => g.stepOid === 'receiver-step')).toBe(true);
    expect(granted.some(g => g.stepOid === 'sender-step')).toBe(true);
    const data = mgr.getSyncData('receiver-step');
    expect(data).toBe('world');
  });

  test('synchronize: both sides wait, then both released', () => {
    const mgr = makeManager();
    expect(mgr.synchronize('wf1:Chan', 's1')).toEqual({ ready: false });
    expect(mgr.synchronize('wf1:Chan', 's2')).toEqual({ ready: true });
    const granted = mgr.flushGranted();
    expect(granted.some(g => g.stepOid === 's1')).toBe(true);
    expect(granted.some(g => g.stepOid === 's2')).toBe(true);
  });
});

describe('InMemoryResourceManager — cancelQueuedWaiters', () => {
  test('removes waiters from binary/shared/countable/named/sync queues without touching pool state', () => {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Lock', { name: 'Lock', resource_type: 'binary exclusive use' }, 'wf1');
    mgr.registerResource('wf1:Pool', { name: 'Pool', resource_type: 'binary shared use with pool limits', use_limit: 1 }, 'wf1');
    mgr.registerResource('wf1:Slots', { name: 'Slots', resource_type: 'countable use with pool limits', use_limit: 5 }, 'wf1');
    mgr.registerResource('wf1:Docks', { name: 'Docks', resource_type: 'named pool', names: ['A', 'B'] }, 'wf1');

    // Hold the binary/shared resources, then queue some waiters.
    mgr.acquire('wf1:Lock', 'holder-step');
    mgr.acquire('wf1:Lock', 's2'); // queued
    mgr.acquire('wf1:Pool', 'holder-step');
    mgr.acquire('wf1:Pool', 's3'); // queued
    mgr.acquireAmount('wf1:Slots', 'holder-step', 5);
    mgr.acquireAmount('wf1:Slots', 's4', 3); // queued
    mgr.acquireNamed('wf1:Docks', 'h1');
    mgr.acquireNamed('wf1:Docks', 'h2');
    mgr.acquireNamed('wf1:Docks', 's5'); // queued

    mgr.cancelQueuedWaiters(new Set(['s2', 's3', 's4', 's5']));

    // Holder still holds: subsequent release grants only the un-cancelled waiters (none here).
    mgr.release('wf1:Lock');
    mgr.release('wf1:Pool');
    mgr.releaseAmount('wf1:Slots', 5);
    mgr.releaseNamed('wf1:Docks', 'A');
    const granted = mgr.flushGranted();
    expect(granted).toEqual([]); // queues were cancelled
  });

  test('does NOT auto-release pool state (model intentionally lacks per-holder tracking)', () => {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Lock', { name: 'Lock', resource_type: 'binary exclusive use' }, 'wf1');
    mgr.acquire('wf1:Lock', 'step-from-aborted-workflow');
    // Cancelling the waiters of an aborted workflow does NOT release what the workflow held.
    // Workflow author is responsible for matching Acquire with Release on the End path.
    mgr.cancelQueuedWaiters(new Set(['step-from-aborted-workflow']));
    // Lock is still held — leak is by design.
    expect(mgr.acquire('wf1:Lock', 's2')).toEqual({ granted: false });
  });
});

// ── Resource command helpers (transcribed from resource-helpers.test.ts) ──

describe('splitResourceCommands', () => {
  test('separates activation and completion commands', () => {
    const commands: ResourceCommandSpecification[] = [
      { command_type: 'Acquire', resource_name: 'Lock' },
      { command_type: 'Release', resource_name: 'Lock' },
      { command_type: 'Send', resource_name: 'Chan' },
      { command_type: 'Release Pool Amount', resource_name: 'Pool', amount: 5 },
    ];
    const { activation, completion } = splitResourceCommands(commands);
    expect(activation.length).toBe(2); // Acquire, Send
    expect(completion.length).toBe(2); // Release, Release Pool Amount
  });
});

describe('sortActivationCommands', () => {
  test('puts sync command first, then alphabetical by resource_name', () => {
    const commands: ResourceCommandSpecification[] = [
      { command_type: 'Acquire', resource_name: 'Zebra' },
      { command_type: 'Send', resource_name: 'Chan' },
      { command_type: 'Acquire', resource_name: 'Alpha' },
    ];
    const sorted = sortActivationCommands(commands);
    expect(sorted[0].command_type).toBe('Send');     // sync first
    expect(sorted[1].resource_name).toBe('Alpha');    // alphabetical
    expect(sorted[2].resource_name).toBe('Zebra');
  });

  test('sorts completion commands alphabetically', () => {
    const commands: ResourceCommandSpecification[] = [
      { command_type: 'Release', resource_name: 'Zebra' },
      { command_type: 'Release', resource_name: 'Alpha' },
    ];
    const sorted = sortActivationCommands(commands);
    expect(sorted[0].resource_name).toBe('Alpha');
    expect(sorted[1].resource_name).toBe('Zebra');
  });
});

// ── Serialization round-trip (adaptation beyond the reference) ──

describe('InMemoryResourceManager — toJSON/fromJSON round-trip', () => {
  test('round-trips an empty manager', () => {
    const mgr = new InMemoryResourceManager();
    const restored = InMemoryResourceManager.fromJSON(JSON.parse(JSON.stringify(mgr.toJSON())));
    expect(restored.getSnapshot()).toEqual([]);
  });

  test('round-trips binary exclusive state (held + queued)', () => {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Lock', { name: 'Lock', resource_type: 'binary exclusive use' }, 'wf1');
    mgr.acquire('wf1:Lock', 's1');
    mgr.acquire('wf1:Lock', 's2'); // queued
    const restored = InMemoryResourceManager.fromJSON(JSON.parse(JSON.stringify(mgr.toJSON())));
    expect(restored.getSnapshot()).toEqual(mgr.getSnapshot());
    restored.release('wf1:Lock');
    const granted = restored.flushGranted();
    expect(granted).toEqual([{ stepOid: 's2', resourceKey: 'wf1:Lock' }]);
  });

  test('round-trips countable state (queue amounts + inUse)', () => {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Slots', { name: 'Slots', resource_type: 'countable use with pool limits', use_limit: 10 }, 'wf1');
    mgr.acquireAmount('wf1:Slots', 's1', 8);
    mgr.acquireAmount('wf1:Slots', 's2', 5); // queued
    const restored = InMemoryResourceManager.fromJSON(JSON.parse(JSON.stringify(mgr.toJSON())));
    expect(restored.getSnapshot()).toEqual(mgr.getSnapshot());
    restored.releaseAmount('wf1:Slots', 8);
    const granted = restored.flushGranted();
    expect(granted).toEqual([{ stepOid: 's2', resourceKey: 'wf1:Slots' }]);
  });

  test('round-trips named pool state (originalNames Set survives as a real Set)', () => {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Docks', { name: 'Docks', resource_type: 'named pool', names: ['Dock 1', 'Dock 2'] }, 'wf1');
    const r1 = mgr.acquireNamed('wf1:Docks', 's1');
    if (!r1.granted || !r1.name) throw new Error('expected grant with name');
    const restored = InMemoryResourceManager.fromJSON(JSON.parse(JSON.stringify(mgr.toJSON())));
    expect(restored.getSnapshot()).toEqual(mgr.getSnapshot());
    // originalNames sanity check still functions post-round-trip (rejects a name that
    // was never part of the pool) — this only works if originalNames deserialized to a Set.
    expect(restored.releaseNamed('wf1:Docks', 'Phantom Dock')).toBe(false);
    expect(restored.releaseNamed('wf1:Docks', r1.name)).toBe(true);
  });

  test('round-trips sync state (sendQueue/receiveQueue/pendingSync + syncMatchedData)', () => {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Chan', { name: 'Chan', resource_type: 'sync' }, 'wf1');
    mgr.receive('wf1:Chan', 'receiver-step');
    mgr.send('wf1:Chan', 'sender-step', 'world'); // ready — populates syncMatchedData
    const restored = InMemoryResourceManager.fromJSON(JSON.parse(JSON.stringify(mgr.toJSON())));
    // getSyncData is per-manager runtime state, not on the snapshot — verify directly.
    expect(restored.getSyncData('receiver-step')).toBe('world');
    restored.clearSyncData('receiver-step');
    expect(restored.getSyncData('receiver-step')).toBeUndefined();
  });

  test('round-trips an unmatched sendQueue entry', () => {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Chan', { name: 'Chan', resource_type: 'sync' }, 'wf1');
    mgr.send('wf1:Chan', 'sender-step', 'unmatched'); // no receiver yet — queued
    const restored = InMemoryResourceManager.fromJSON(JSON.parse(JSON.stringify(mgr.toJSON())));
    const recvResult = restored.receive('wf1:Chan', 'receiver-step');
    expect(recvResult).toEqual({ available: true, data: 'unmatched' });
    const granted = restored.flushGranted();
    expect(granted).toEqual([{ stepOid: 'sender-step', resourceKey: 'wf1:Chan' }]);
  });

  test('round-trips an unmatched pendingSync entry', () => {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Chan', { name: 'Chan', resource_type: 'sync' }, 'wf1');
    mgr.synchronize('wf1:Chan', 's1'); // one side waiting — pendingSync = ['s1']
    const restored = InMemoryResourceManager.fromJSON(JSON.parse(JSON.stringify(mgr.toJSON())));
    const result = restored.synchronize('wf1:Chan', 's2');
    expect(result).toEqual({ ready: true });
    const granted = restored.flushGranted();
    expect(granted.some(g => g.stepOid === 's1')).toBe(true);
    expect(granted.some(g => g.stepOid === 's2')).toBe(true);
  });

  test('round-trips pendingNamedAssignments (consumePendingNamedAssignment works after restore)', () => {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Docks', { name: 'Docks', resource_type: 'named pool', names: ['Dock 1'] }, 'wf1');
    const r1 = mgr.acquireNamed('wf1:Docks', 's1');
    mgr.acquireNamed('wf1:Docks', 's2'); // queued
    if (!r1.granted || !r1.name) throw new Error('expected grant with name');
    mgr.releaseNamed('wf1:Docks', r1.name); // grants s2, reserves name in pendingNamedAssignments
    const restored = InMemoryResourceManager.fromJSON(JSON.parse(JSON.stringify(mgr.toJSON())));
    expect(restored.consumePendingNamedAssignment('s2')).toBe(r1.name);
    expect(restored.consumePendingNamedAssignment('s2')).toBeUndefined();
  });

  test('round-trips pendingGrants (flushGranted returns them after restore)', () => {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Lock', { name: 'Lock', resource_type: 'binary exclusive use' }, 'wf1');
    mgr.acquire('wf1:Lock', 's1');
    mgr.acquire('wf1:Lock', 's2'); // queued
    mgr.release('wf1:Lock'); // grants s2 into pendingGrants, NOT flushed yet
    const restored = InMemoryResourceManager.fromJSON(JSON.parse(JSON.stringify(mgr.toJSON())));
    const granted = restored.flushGranted();
    expect(granted).toEqual([{ stepOid: 's2', resourceKey: 'wf1:Lock' }]);
  });

  test('mid-contention round-trip: same grant order as the un-serialized manager', () => {
    // Build a manager mid-contention: a binary-exclusive holder with two queued waiters.
    function buildManager(): InMemoryResourceManager {
      const mgr = new InMemoryResourceManager();
      mgr.registerResource('wf1:Lock', { name: 'Lock', resource_type: 'binary exclusive use' }, 'wf1');
      mgr.acquire('wf1:Lock', 'holder'); // granted, holds the lock
      mgr.acquire('wf1:Lock', 's2');     // queued (1st in line)
      mgr.acquire('wf1:Lock', 's3');     // queued (2nd in line)
      return mgr;
    }

    const live = buildManager();
    const serialized = buildManager();
    const restored = InMemoryResourceManager.fromJSON(JSON.parse(JSON.stringify(serialized.toJSON())));

    // Release twice on each and compare grant order — must match exactly.
    live.release('wf1:Lock');
    const liveGrant1 = live.flushGranted();
    live.release('wf1:Lock');
    const liveGrant2 = live.flushGranted();

    restored.release('wf1:Lock');
    const restoredGrant1 = restored.flushGranted();
    restored.release('wf1:Lock');
    const restoredGrant2 = restored.flushGranted();

    expect(restoredGrant1).toEqual(liveGrant1);
    expect(restoredGrant2).toEqual(liveGrant2);
    expect(restoredGrant1).toEqual([{ stepOid: 's2', resourceKey: 'wf1:Lock' }]);
    expect(restoredGrant2).toEqual([{ stepOid: 's3', resourceKey: 'wf1:Lock' }]);
  });

  test('toJSON snapshot is independent of later mutation (no live-reference aliasing)', () => {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Lock', { name: 'Lock', resource_type: 'binary exclusive use' }, 'wf1');
    mgr.acquire('wf1:Lock', 's1');
    const snapshot = mgr.toJSON();
    // Mutate the manager AFTER taking the snapshot — the snapshot must not reflect it.
    mgr.acquire('wf1:Lock', 's2'); // queued
    mgr.release('wf1:Lock');
    const restoredFromStaleSnapshot = InMemoryResourceManager.fromJSON(snapshot);
    // The stale snapshot predates s2's queueing — Lock should read as still held by s1,
    // with nobody queued.
    expect(restoredFromStaleSnapshot.acquire('wf1:Lock', 's3')).toEqual({ granted: false });
    expect(restoredFromStaleSnapshot.flushGranted()).toEqual([]);
  });

  test('SerializedResources JSON shape has no Map/Set anywhere', () => {
    const mgr = new InMemoryResourceManager();
    mgr.registerResource('wf1:Docks', { name: 'Docks', resource_type: 'named pool', names: ['A', 'B'] }, 'wf1');
    mgr.registerResource('wf1:Chan', { name: 'Chan', resource_type: 'sync' }, 'wf1');
    mgr.acquireNamed('wf1:Docks', 's1');
    mgr.receive('wf1:Chan', 'r1');
    mgr.send('wf1:Chan', 'snd1', 'payload');
    // Must survive a real JSON.stringify/parse round trip with no loss (Map/Set would
    // silently become {} or [] through JSON.stringify, which is exactly the bug this
    // adaptation exists to prevent).
    const json = JSON.stringify(mgr.toJSON());
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed.resources)).toBe(true);
    expect(Array.isArray(parsed.syncMatchedData)).toBe(true);
    expect(Array.isArray(parsed.pendingNamedAssignments)).toBe(true);
    const restored = InMemoryResourceManager.fromJSON(parsed);
    expect(restored.hasResource('wf1:Docks')).toBe(true);
    expect(restored.getSyncData('r1')).toBe('payload');
  });
});
