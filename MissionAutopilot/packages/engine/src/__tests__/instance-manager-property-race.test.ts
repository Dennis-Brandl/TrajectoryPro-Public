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

/**
 * instance-manager-property-race.test.ts — Regression test for the lost-update
 * race in InstanceManager.applyPropertyMutations().
 *
 * Pre-port (SQLite/better-sqlite3), applyPropertyMutations was fully
 * synchronous: findByOid → mutate the in-memory JSON array → update, with
 * nothing able to interleave. The Postgres port made both the read and the
 * write real async round-trips, which reopened the classic lost-update race:
 * two instances finishing near-simultaneously in the same environment can
 * both read the whole `action_property_specifications` array before either
 * writes, so the second write silently erases the first's mutations.
 *
 * The fix serializes applyPropertyMutations() through a per-InstanceManager
 * promise chain (`propertyMutationChain`). This test proves that chain closes
 * the race — it does NOT rely on incidental DB timing to expose the bug: it
 * deterministically forces the worst-case interleaving via a gated read (the
 * first call's `findByOid` result is captured immediately but withheld from
 * its caller until released), then shows both concurrent mutations survive.
 *
 * Deliberate-break check (see the fix-report): this exact test was run
 * against a temporarily unserialized `applyPropertyMutations` (calling the
 * raw read-modify-write directly, bypassing the chain) and observed to FAIL
 * — call B's mutation was lost — before the chain implementation was
 * restored and the test re-verified green. That confirms the test actually
 * catches the regression it's guarding against.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { EnvironmentRepository } from '@mission/autopilot-storage'
import { createTestDb, type TestDb } from '@mission/autopilot-storage/testing'
import { InstanceManager } from '../instance-manager/instance-manager.js'

// ============================================================
// Shared state
// ============================================================

let db: TestDb
let envRepo: EnvironmentRepository

beforeAll(async () => {
  db = await createTestDb()
  envRepo = new EnvironmentRepository(db)
})

afterAll(async () => {
  await db.close()
})

// ============================================================
// Test suite
// ============================================================

describe('InstanceManager — applyPropertyMutations concurrency', () => {
  it('serializes two concurrent calls so neither write clobbers the other', async () => {
    const envOid = `env-race-${Date.now()}`
    await envRepo.create({
      oid: envOid,
      local_id: 'race-test-env',
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      schema_version: '1',
      action_property_specifications: [
        {
          name: 'SIM',
          entries: [
            { name: 'A', value: '0' },
            { name: 'B', value: '0' },
          ],
        },
      ],
      value_property_specifications: [],
      resource_property_specifications: [],
      source_filename: 'race-test.json',
    })

    // Gate the FIRST findByOid call: capture its real (pre-mutation) result
    // immediately, but withhold RETURNING it to the caller until the test
    // releases the gate. This forces the worst-case interleaving — call A
    // holds a stale snapshot exactly as long as it takes call B to fully
    // finish — using deterministic promise gating rather than any timing
    // assumption or sleep.
    const originalFindByOid = EnvironmentRepository.prototype.findByOid
    let readCount = 0
    let releaseFirstRead!: () => void
    const firstReadGate = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    const findByOidSpy = vi
      .spyOn(EnvironmentRepository.prototype, 'findByOid')
      .mockImplementation(async function (this: EnvironmentRepository, oid: string) {
        readCount += 1
        const callIndex = readCount
        const snapshot = await originalFindByOid.call(this, oid)
        if (callIndex === 1) {
          await firstReadGate
        }
        return snapshot
      })

    // poolSize: 0 — this test never calls invoke()/executes code, so no
    // Python workers are needed; skips spawning subprocesses against a
    // scriptPath that doesn't exist.
    const manager = new InstanceManager(db, {
      scriptPath: 'unused-for-this-test',
      poolSize: 0,
    })

    // Declared outside the try so `finally` can always settle them —
    // otherwise a failed assertion below would throw before `releaseFirstRead()`
    // runs, leaving call A parked forever on `await firstReadGate` and hanging
    // the whole test run instead of failing it cleanly.
    let callA: Promise<void> | undefined
    let callB: Promise<void> | undefined

    try {
      // Fire both calls through the PRIVATE applyPropertyMutations() entry
      // point without awaiting the first — this is the shape of two
      // near-simultaneous StateMachine onPropertyMutations callbacks racing
      // on the same environment.
      const managerAny = manager as unknown as {
        applyPropertyMutations: (
          environment_oid: string,
          source_action_oid: string,
          source_instance_id: string,
          mutations: Array<{ spec_name: string; entry_name: string; value: string }>
        ) => Promise<void>
      }

      callA = managerAny.applyPropertyMutations(envOid, 'action-A', 'instance-A', [
        { spec_name: 'SIM', entry_name: 'A', value: '1' },
      ])
      callB = managerAny.applyPropertyMutations(envOid, 'action-B', 'instance-B', [
        { spec_name: 'SIM', entry_name: 'B', value: '1' },
      ])

      // Flush microtasks so call A's run() reaches (and blocks on) the gate.
      for (let i = 0; i < 5; i++) {
        await Promise.resolve()
      }

      // Proof of serialization: call B's run() is chained behind call A's
      // whole read-modify-write and structurally cannot start until call A's
      // link settles — so no matter how long we wait here, only call A's
      // read has happened.
      expect(readCount).toBe(1)

      releaseFirstRead()
      await Promise.all([callA, callB])

      const finalEnv = (await envRepo.findByOid(envOid))!
      const specs = finalEnv.action_property_specifications as Array<{
        name: string
        entries: Array<{ name: string; value: string }>
      }>
      const sim = specs.find((s) => s.name === 'SIM')!
      expect(sim.entries.find((e) => e.name === 'A')?.value).toBe('1')
      expect(sim.entries.find((e) => e.name === 'B')?.value).toBe('1')
    } finally {
      // Idempotent: a no-op if the try block already released it. Guarantees
      // call A can never be left parked on the gate, so this test fails
      // cleanly (wrong values / wrong readCount) instead of hanging when the
      // serialization it's checking for is missing or broken.
      releaseFirstRead()
      await Promise.allSettled([callA, callB])
      findByOidSpy.mockRestore()
      await manager.shutdown()
    }
  }, 30000)

  it('queues a console setPropertyValues() edit behind an in-flight runtime write', async () => {
    const envOid = `env-race-console-${Date.now()}`
    await envRepo.create({
      oid: envOid,
      local_id: 'race-test-env-console',
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      schema_version: '1',
      action_property_specifications: [
        {
          name: 'SIM',
          entries: [
            { name: 'A', value: '0' },
            { name: 'B', value: '0' },
          ],
        },
      ],
      value_property_specifications: [],
      resource_property_specifications: [],
      source_filename: 'race-test.json',
    })

    // Same gated-read shape as the test above: the runtime write's findByOid
    // is withheld until released, so a console edit that did its own
    // read-modify-write outside the chain would finish first and be erased
    // when the runtime write lands its stale snapshot.
    const originalFindByOid = EnvironmentRepository.prototype.findByOid
    let readCount = 0
    let releaseFirstRead!: () => void
    const firstReadGate = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    const findByOidSpy = vi
      .spyOn(EnvironmentRepository.prototype, 'findByOid')
      .mockImplementation(async function (this: EnvironmentRepository, oid: string) {
        readCount += 1
        const callIndex = readCount
        const snapshot = await originalFindByOid.call(this, oid)
        if (callIndex === 1) {
          await firstReadGate
        }
        return snapshot
      })

    const manager = new InstanceManager(db, {
      scriptPath: 'unused-for-this-test',
      poolSize: 0,
    })

    let runtimeWrite: Promise<void> | undefined
    let consoleEdit: Promise<unknown> | undefined

    try {
      const managerAny = manager as unknown as {
        applyPropertyMutations: (
          environment_oid: string,
          source_action_oid: string,
          source_instance_id: string,
          mutations: Array<{ spec_name: string; entry_name: string; value: string }>
        ) => Promise<void>
      }

      runtimeWrite = managerAny.applyPropertyMutations(envOid, 'action-A', 'instance-A', [
        { spec_name: 'SIM', entry_name: 'A', value: '1' },
      ])
      consoleEdit = manager.setPropertyValues(envOid, [
        { spec_name: 'SIM', entry_name: 'B', value: '1' },
      ])

      for (let i = 0; i < 5; i++) {
        await Promise.resolve()
      }

      // The console edit must not have read yet — it is chained behind the
      // runtime write's whole read-modify-write.
      expect(readCount).toBe(1)

      releaseFirstRead()
      await Promise.all([runtimeWrite, consoleEdit])

      const finalEnv = (await envRepo.findByOid(envOid))!
      const specs = finalEnv.action_property_specifications as Array<{
        name: string
        entries: Array<{ name: string; value: string }>
      }>
      const sim = specs.find((s) => s.name === 'SIM')!
      expect(sim.entries.find((e) => e.name === 'A')?.value).toBe('1')
      expect(sim.entries.find((e) => e.name === 'B')?.value).toBe('1')
    } finally {
      releaseFirstRead()
      await Promise.allSettled([runtimeWrite, consoleEdit])
      findByOidSpy.mockRestore()
      await manager.shutdown()
    }
  }, 30000)

  it('shutdown() waits for a queued property mutation before closing the pool', async () => {
    const envOid = `env-shutdown-${Date.now()}`
    await envRepo.create({
      oid: envOid,
      local_id: 'shutdown-test-env',
      version: '1.0',
      last_modified_date: new Date().toISOString(),
      schema_version: '1',
      action_property_specifications: [
        {
          name: 'SIM',
          entries: [{ name: 'A', value: '0' }],
        },
      ],
      value_property_specifications: [],
      resource_property_specifications: [],
      source_filename: 'shutdown-test.json',
    })

    // Gate the environment WRITE (not the read) so the mutation is still
    // in-flight — parked mid-write on the propertyMutationChain — when
    // shutdown() is called. Same gated-call shape as the tests above:
    // capture the original, spy with mockImplementation, delegate after the
    // gate releases.
    const originalUpdate = EnvironmentRepository.prototype.update
    let releaseWrite!: () => void
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const updateSpy = vi
      .spyOn(EnvironmentRepository.prototype, 'update')
      .mockImplementation(async function (
        this: EnvironmentRepository,
        ...args: Parameters<typeof originalUpdate>
      ) {
        await writeGate
        return originalUpdate.apply(this, args)
      })

    const manager = new InstanceManager(db, {
      scriptPath: 'unused-for-this-test',
      poolSize: 0,
    })

    let mutation: Promise<void> | undefined
    let shutdownPromise: Promise<void> | undefined

    try {
      const managerAny = manager as unknown as {
        applyPropertyMutations: (
          environment_oid: string,
          source_action_oid: string,
          source_instance_id: string,
          mutations: Array<{ spec_name: string; entry_name: string; value: string }>
        ) => Promise<void>
        pool: { shutdown: () => Promise<void> }
      }

      mutation = managerAny.applyPropertyMutations(envOid, 'action-A', 'instance-A', [
        { spec_name: 'SIM', entry_name: 'A', value: '1' },
      ])

      const poolShutdownSpy = vi.spyOn(managerAny.pool, 'shutdown')

      shutdownPromise = manager.shutdown()

      // Give shutdown() every chance to race ahead if it were NOT draining
      // the chain first — it must still be waiting on the gated write.
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(poolShutdownSpy).not.toHaveBeenCalled()

      releaseWrite()
      await mutation
      await shutdownPromise

      expect(poolShutdownSpy).toHaveBeenCalledTimes(1)
    } finally {
      releaseWrite()
      await Promise.allSettled([mutation, shutdownPromise])
      updateSpy.mockRestore()
    }
  }, 30000)
})
