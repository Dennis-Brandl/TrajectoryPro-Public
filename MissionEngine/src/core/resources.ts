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
// Transcribed from the reference repo's engines/web/src/resource-manager.ts (verbatim,
// including FIFO ordering and grant semantics) plus engines/web/src/resource-helpers.ts
// (splitResourceCommands, sortActivationCommands — appended here per task-8-brief.md's
// "implementer's choice" on file layout). TWO adaptations beyond the reference: (1) full-state
// serialization via toJSON()/fromJSON() so a paused/persisted engine can round-trip its
// ResourceManager through `workflow_instance` storage (see the SerializedResources type and the
// toJSON/fromJSON methods below), and (2) `runGrantPass` — a grant pass with no release, which
// the shared work-center registry needs when a WAITING instance's token is cancelled rather than
// released (see its own doc comment). Everything else is verbatim.
import type { ResourcePropertySpecification, ResourceSnapshotEntry, ResourceCommandSpecification } from '../spec/types.js';
import { summarizeResource, type ResourceSummaryInput } from 'mission-control-db/src/runtime/resource-summary';

// ── Result Types ──

export type AcquireResult = { granted: true; name?: string } | { granted: false };
export type ReceiveResult = { available: true; data: string } | { available: false };
export type SyncResult = { ready: true } | { ready: false };
export type GrantEntry = { stepOid: string; resourceKey: string };

// ── Interface ──
//
// MODEL: Resource pools are pure state (counts or lists of names). Acquire decrements;
// Release increments. The manager does NOT track WHO holds what — it is the workflow
// author's responsibility to release the correct name (named pool) or amount (countable)
// that they originally acquired. There is no auto-release on workflow abort.
//
// Resources are identified by a composite resourceKey (resource_source_oid:resource_name).
//
// stepOid (and instance-prefixed variants for cross-workflow sync) is used ONLY for
// queue routing — when a Release frees pool capacity, the head-of-queue stepOid is
// added to pendingGrants so its engine can resume the waiting step.

export interface ResourceManager {
  registerResource(resourceKey: string, spec: ResourcePropertySpecification, ownerId: string, scope?: 'workflow' | 'environment'): void;
  unregisterResources(ownerId: string): void;

  acquire(resourceKey: string, stepOid: string, amount?: number): AcquireResult;
  /** Release one unit (binary/shared) or `amount` units (countable) or `name` (named pool). */
  release(resourceKey: string, amount?: number, name?: string): boolean;

  acquireAmount(resourceKey: string, stepOid: string, amount: number): AcquireResult;
  releaseAmount(resourceKey: string, amount: number): void;

  acquireNamed(resourceKey: string, stepOid: string): AcquireResult;
  /** Returns true if name was returned to pool, false if name was already available
   *  (double-release) or not part of this pool at registration time. */
  releaseNamed(resourceKey: string, name: string): boolean;

  send(resourceKey: string, stepOid: string, data: string): SyncResult;
  receive(resourceKey: string, stepOid: string): ReceiveResult;
  synchronize(resourceKey: string, stepOid: string): SyncResult;

  getSyncData(stepOid: string): string | undefined;
  clearSyncData(stepOid: string): void;

  /** When a queued named-pool Acquire becomes grantable, the manager reserves the name
   *  out of `available` and records it here. The engine consumes this on grant processing
   *  to write the name to the Acquire's cmd.target property. */
  consumePendingNamedAssignment(stepOid: string): string | undefined;

  flushGranted(knownStepOids?: Set<string>): GrantEntry[];
  /** Cancel all queued waiters whose stepOid is in `stepOids`. Pool state is NOT
   *  modified — the workflow author is responsible for releasing what was acquired
   *  (model intentionally has no per-holder tracking, so abort cleanup of pool
   *  state is impossible). */
  cancelQueuedWaiters(stepOids: Set<string>): void;

  /** Re-run the FIFO grant pass for ONE resource without releasing anything (Phase 2a, C1/I1
   *  fix — see the implementation's own doc comment). Not part of the reference manager. */
  runGrantPass(resourceKey: string): void;

  /** Explicit user action: reset each named resource to its registered initial state
   *  (inUse=0 / available=originalNames). Queue is preserved and tryGrant runs so any
   *  waiters can immediately be served from the now-free pool. Returns the resourceKeys
   *  that actually had non-default state before the reset. */
  resetResources(resourceKeys: Set<string>): string[];

  hasResource(resourceKey: string): boolean;
  getSnapshot(): ResourceSnapshotEntry[];
}

// ── Internal State Types ──

interface BinaryExclusiveState {
  type: 'binary exclusive use';
  inUse: 0 | 1;
  queue: string[];                    // queue of waiting stepOids
  ownerId: string;
  scope: 'workflow' | 'environment';
  resourceKey: string;
}

interface BinarySharedState {
  type: 'binary shared use with pool limits';
  inUse: number;
  useLimit: number;
  queue: string[];
  ownerId: string;
  scope: 'workflow' | 'environment';
  resourceKey: string;
}

interface CountableState {
  type: 'countable use with pool limits';
  inUse: number;
  useLimit: number;
  queue: { stepOid: string; amount: number }[];
  ownerId: string;
  scope: 'workflow' | 'environment';
  resourceKey: string;
}

interface NamedPoolState {
  type: 'named pool';
  available: string[];                // names currently free
  originalNames: Set<string>;         // sanity check on release: only names from this pool can be returned
  queue: string[];
  ownerId: string;
  scope: 'workflow' | 'environment';
  resourceKey: string;
}

interface SyncState {
  type: 'sync';
  sendQueue: { stepOid: string; data: string }[];
  receiveQueue: string[];
  pendingSync: string[];
  ownerId: string;
  scope: 'workflow' | 'environment';
  resourceKey: string;
}

type ResourceState = BinaryExclusiveState | BinarySharedState | CountableState | NamedPoolState | SyncState;

// ── Serialization (adaptation beyond the reference) ──
//
// Plain-object/array mirror of ResourceState with no Map/Set anywhere in the shape, so
// SerializedResources round-trips cleanly through JSON.stringify/JSON.parse. The only
// divergence from the internal state types is NamedPoolState.originalNames: Set<string>
// becomes originalNames: string[].
type SerializedResourceState =
  | BinaryExclusiveState
  | BinarySharedState
  | CountableState
  | (Omit<NamedPoolState, 'originalNames'> & { originalNames: string[] })
  | SyncState;

export interface SerializedResources {
  resources: [string, SerializedResourceState][];
  pendingGrants: GrantEntry[];
  syncMatchedData: [string, string][];
  pendingNamedAssignments: [string, string][];
}

function stateToJSON(state: ResourceState): SerializedResourceState {
  switch (state.type) {
    case 'binary exclusive use':
    case 'binary shared use with pool limits':
      return { ...state, queue: [...state.queue] };
    case 'countable use with pool limits':
      return { ...state, queue: state.queue.map(q => ({ ...q })) };
    case 'named pool':
      return { ...state, available: [...state.available], originalNames: [...state.originalNames], queue: [...state.queue] };
    case 'sync':
      return {
        ...state,
        sendQueue: state.sendQueue.map(s => ({ ...s })),
        receiveQueue: [...state.receiveQueue],
        pendingSync: [...state.pendingSync],
      };
  }
}

function stateFromJSON(state: SerializedResourceState): ResourceState {
  switch (state.type) {
    case 'binary exclusive use':
    case 'binary shared use with pool limits':
      return { ...state, queue: [...state.queue] };
    case 'countable use with pool limits':
      return { ...state, queue: state.queue.map(q => ({ ...q })) };
    case 'named pool':
      return { ...state, available: [...state.available], originalNames: new Set(state.originalNames), queue: [...state.queue] };
    case 'sync':
      return {
        ...state,
        sendQueue: state.sendQueue.map(s => ({ ...s })),
        receiveQueue: [...state.receiveQueue],
        pendingSync: [...state.pendingSync],
      };
  }
}

// Phase 3 (spec §6.1): the summary strings have ONE home — mission-control-db's
// summarizeResource — so the Mission Commander's read DAOs and this snapshot can never drift
// into two vocabularies. This adapter only maps the private state union onto its input.
function summaryInputOf(r: ResourceState): ResourceSummaryInput {
  switch (r.type) {
    case 'binary exclusive use':
      return { type: r.type, inUse: r.inUse, queued: r.queue.length };
    case 'binary shared use with pool limits':
      return { type: r.type, inUse: r.inUse, useLimit: r.useLimit, queued: r.queue.length };
    case 'countable use with pool limits':
      return { type: r.type, inUse: r.inUse, useLimit: r.useLimit, queued: r.queue.length };
    case 'named pool':
      return { type: r.type, poolSize: r.originalNames.size, available: r.available.length, queued: r.queue.length };
    case 'sync':
      return { type: r.type, send: r.sendQueue.length, receive: r.receiveQueue.length, sync: r.pendingSync.length };
  }
}

// ── Implementation ──

export class InMemoryResourceManager implements ResourceManager {
  private resources = new Map<string, ResourceState>();
  private pendingGrants: GrantEntry[] = [];
  private syncMatchedData = new Map<string, string>();
  private pendingNamedAssignments = new Map<string, string>();

  registerResource(resourceKey: string, spec: ResourcePropertySpecification, ownerId: string, scope?: 'workflow' | 'environment'): void {
    if (this.resources.has(resourceKey)) return;
    const resolvedScope: 'workflow' | 'environment' = scope ?? (spec.scope === 'environment' ? 'environment' : 'workflow');
    switch (spec.resource_type) {
      case 'binary exclusive use':
        this.resources.set(resourceKey, { type: 'binary exclusive use', inUse: 0, queue: [], ownerId, scope: resolvedScope, resourceKey });
        break;
      case 'binary shared use with pool limits':
        this.resources.set(resourceKey, { type: 'binary shared use with pool limits', inUse: 0, useLimit: spec.use_limit ?? 1, queue: [], ownerId, scope: resolvedScope, resourceKey });
        break;
      case 'countable use with pool limits':
        this.resources.set(resourceKey, { type: 'countable use with pool limits', inUse: 0, useLimit: spec.use_limit ?? 1, queue: [], ownerId, scope: resolvedScope, resourceKey });
        break;
      case 'named pool': {
        const names = [...(spec.names ?? [])];
        this.resources.set(resourceKey, { type: 'named pool', available: names, originalNames: new Set(names), queue: [], ownerId, scope: resolvedScope, resourceKey });
        break;
      }
      case 'sync':
        this.resources.set(resourceKey, { type: 'sync', sendQueue: [], receiveQueue: [], pendingSync: [], ownerId, scope: resolvedScope, resourceKey });
        break;
      default:
        throw new Error(`Unknown resource type: "${spec.resource_type}"`);
    }
  }

  unregisterResources(ownerId: string): void {
    for (const [key, state] of this.resources) {
      if (state.ownerId === ownerId) {
        this.resources.delete(key);
      }
    }
  }

  hasResource(resourceKey: string): boolean {
    return this.resources.has(resourceKey);
  }

  private getResource(key: string): ResourceState {
    const r = this.resources.get(key);
    if (!r) throw new Error(`Resource "${key}" is not registered`);
    return r;
  }

  private addGrant(stepOid: string, resourceKey: string): void {
    this.pendingGrants.push({ stepOid, resourceKey });
  }

  // ── Acquire / Release dispatchers ──

  acquire(resourceKey: string, stepOid: string, amount?: number): AcquireResult {
    const r = this.getResource(resourceKey);
    switch (r.type) {
      case 'binary exclusive use': {
        if (r.inUse === 0 && r.queue.length === 0) {
          r.inUse = 1;
          return { granted: true };
        }
        r.queue.push(stepOid);
        return { granted: false };
      }
      case 'binary shared use with pool limits': {
        if (r.inUse < r.useLimit && r.queue.length === 0) {
          r.inUse++;
          return { granted: true };
        }
        r.queue.push(stepOid);
        return { granted: false };
      }
      case 'countable use with pool limits':
        return this.acquireAmount(resourceKey, stepOid, amount ?? 1);
      case 'named pool':
        return this.acquireNamed(resourceKey, stepOid);
      default:
        throw new Error(`acquire() not supported for resource type "${r.type}"`);
    }
  }

  release(resourceKey: string, amount?: number, name?: string): boolean {
    const r = this.getResource(resourceKey);
    switch (r.type) {
      case 'binary exclusive use': {
        if (r.inUse === 0) return false;
        r.inUse = 0;
        this.tryGrantBinaryExclusive(r);
        return true;
      }
      case 'binary shared use with pool limits': {
        if (r.inUse === 0) return false;
        r.inUse--;
        this.tryGrantBinaryShared(r);
        return true;
      }
      case 'countable use with pool limits':
        this.releaseAmount(resourceKey, amount ?? 1);
        return true;
      case 'named pool':
        if (!name) return false;
        return this.releaseNamed(resourceKey, name);
      default:
        return false;
    }
  }

  private tryGrantBinaryExclusive(r: BinaryExclusiveState): void {
    if (r.inUse === 0 && r.queue.length > 0) {
      const next = r.queue.shift()!;
      r.inUse = 1;
      this.addGrant(next, r.resourceKey);
    }
  }

  private tryGrantBinaryShared(r: BinarySharedState): void {
    while (r.inUse < r.useLimit && r.queue.length > 0) {
      const next = r.queue.shift()!;
      r.inUse++;
      this.addGrant(next, r.resourceKey);
    }
  }

  // ── Countable ──

  acquireAmount(resourceKey: string, stepOid: string, amount: number): AcquireResult {
    const r = this.getResource(resourceKey);
    if (r.type !== 'countable use with pool limits') throw new Error(`acquireAmount() not supported for "${r.type}"`);
    if (r.inUse + amount <= r.useLimit && r.queue.length === 0) {
      r.inUse += amount;
      return { granted: true };
    }
    r.queue.push({ stepOid, amount });
    return { granted: false };
  }

  releaseAmount(resourceKey: string, amount: number): void {
    const r = this.getResource(resourceKey);
    if (r.type !== 'countable use with pool limits') throw new Error(`releaseAmount() not supported for "${r.type}"`);
    // Defensive bounds: floor at 0, accept what the workflow author releases.
    r.inUse = Math.max(0, r.inUse - amount);
    this.tryGrantCountable(r);
  }

  private tryGrantCountable(r: CountableState): void {
    while (r.queue.length > 0) {
      const head = r.queue[0];
      if (r.inUse + head.amount <= r.useLimit) {
        r.queue.shift();
        r.inUse += head.amount;
        this.addGrant(head.stepOid, r.resourceKey);
      } else {
        break; // strict FIFO — don't skip a too-large request
      }
    }
  }

  // ── Named Pool ──

  acquireNamed(resourceKey: string, stepOid: string): AcquireResult {
    const r = this.getResource(resourceKey);
    if (r.type !== 'named pool') throw new Error(`acquireNamed() not supported for "${r.type}"`);
    if (r.available.length > 0 && r.queue.length === 0) {
      const name = r.available.shift()!;
      return { granted: true, name };
    }
    r.queue.push(stepOid);
    return { granted: false };
  }

  releaseNamed(resourceKey: string, name: string): boolean {
    const r = this.getResource(resourceKey);
    if (r.type !== 'named pool') return false;
    // Sanity: only names that originally belonged to this pool can be released.
    // Silently ignore double-release (name already in available).
    if (!r.originalNames.has(name)) return false;
    if (r.available.includes(name)) return false;
    r.available.push(name);
    this.tryGrantNamed(r);
    return true;
  }

  private tryGrantNamed(r: NamedPoolState): void {
    // Reserve names at grant time so an unrelated workflow can't acquire them between
    // when we emit the grant and when the granted step's engine resumes. Record the
    // reserved name in pendingNamedAssignments — the engine reads it on grant
    // processing to write the name to the Acquire's cmd.target property.
    while (r.available.length > 0 && r.queue.length > 0) {
      const stepOid = r.queue.shift()!;
      const name = r.available.shift()!;
      this.pendingNamedAssignments.set(stepOid, name);
      this.addGrant(stepOid, r.resourceKey);
    }
  }

  /** Engine consumes the name reserved for a queued Acquire when processing its grant. */
  consumePendingNamedAssignment(stepOid: string): string | undefined {
    const name = this.pendingNamedAssignments.get(stepOid);
    if (name !== undefined) this.pendingNamedAssignments.delete(stepOid);
    return name;
  }

  // ── Sync ──

  send(resourceKey: string, stepOid: string, data: string): SyncResult {
    const r = this.getResource(resourceKey);
    if (r.type !== 'sync') throw new Error(`send() not supported for "${r.type}"`);
    if (r.receiveQueue.length > 0) {
      const receiverStepOid = r.receiveQueue.shift()!;
      this.addGrant(stepOid, r.resourceKey);
      this.addGrant(receiverStepOid, r.resourceKey);
      this.syncMatchedData.set(receiverStepOid, data);
      return { ready: true };
    }
    r.sendQueue.push({ stepOid, data });
    return { ready: false };
  }

  receive(resourceKey: string, stepOid: string): ReceiveResult {
    const r = this.getResource(resourceKey);
    if (r.type !== 'sync') throw new Error(`receive() not supported for "${r.type}"`);
    if (r.sendQueue.length > 0) {
      const sender = r.sendQueue.shift()!;
      this.addGrant(sender.stepOid, r.resourceKey);
      return { available: true, data: sender.data };
    }
    r.receiveQueue.push(stepOid);
    return { available: false };
  }

  synchronize(resourceKey: string, stepOid: string): SyncResult {
    const r = this.getResource(resourceKey);
    if (r.type !== 'sync') throw new Error(`synchronize() not supported for "${r.type}"`);
    r.pendingSync.push(stepOid);
    if (r.pendingSync.length >= 2) {
      const first = r.pendingSync.shift()!;
      const second = r.pendingSync.shift()!;
      this.addGrant(first, r.resourceKey);
      this.addGrant(second, r.resourceKey);
      return { ready: true };
    }
    return { ready: false };
  }

  getSyncData(stepOid: string): string | undefined {
    return this.syncMatchedData.get(stepOid);
  }

  clearSyncData(stepOid: string): void {
    this.syncMatchedData.delete(stepOid);
  }

  flushGranted(knownStepOids?: Set<string>): GrantEntry[] {
    if (!knownStepOids) {
      const result = [...this.pendingGrants];
      this.pendingGrants = [];
      return result;
    }
    const taken: GrantEntry[] = [];
    const remaining: GrantEntry[] = [];
    for (const grant of this.pendingGrants) {
      if (knownStepOids.has(grant.stepOid)) {
        taken.push(grant);
      } else {
        remaining.push(grant);
      }
    }
    this.pendingGrants = remaining;
    return taken;
  }

  cancelQueuedWaiters(stepOids: Set<string>): void {
    for (const state of this.resources.values()) {
      if (state.type === 'binary exclusive use'
        || state.type === 'binary shared use with pool limits'
        || state.type === 'named pool') {
        state.queue = state.queue.filter(s => !stepOids.has(s));
      } else if (state.type === 'countable use with pool limits') {
        state.queue = state.queue.filter(q => !stepOids.has(q.stepOid));
      } else if (state.type === 'sync') {
        state.sendQueue = state.sendQueue.filter(s => !stepOids.has(s.stepOid));
        state.receiveQueue = state.receiveQueue.filter(s => !stepOids.has(s));
        state.pendingSync = state.pendingSync.filter(s => !stepOids.has(s));
      }
    }
    // Clear pending grants and named-pool assignments for cancelled steps; if any names
    // were already reserved for these steps, return them to the pool.
    this.pendingGrants = this.pendingGrants.filter(g => !stepOids.has(g.stepOid));
    for (const [stepOid, name] of this.pendingNamedAssignments) {
      if (stepOids.has(stepOid)) {
        this.pendingNamedAssignments.delete(stepOid);
        // Find the resource and return the name. Linear scan acceptable for cleanup path.
        for (const state of this.resources.values()) {
          if (state.type === 'named pool' && state.originalNames.has(name) && !state.available.includes(name)) {
            state.available.push(name);
            break;
          }
        }
      }
    }
  }

  /**
   * Re-run ONLY the FIFO grant pass for `resourceKey` — no counter is touched except by a grant
   * this pass itself makes. The SECOND adaptation beyond the reference manager (after
   * toJSON/fromJSON), added by Phase 2a's whole-branch review (C1/I1): `release()` is the
   * reference's only door into `tryGrant*`, but a terminal instance that merely WAITED on a
   * resource has nothing to release — cancelQueuedWaiters just removes its token — and for a
   * COUNTABLE resource the strict no-skip rule (tryGrantCountable's own `break`) makes "free
   * capacity + a non-empty queue" a legitimate steady state. Removing a too-large head there
   * can make a smaller request behind it satisfiable with nobody left to notice: the pool has
   * room, the queue is non-empty, and no future release() is owed on this resource by anyone.
   *
   * Deliberately NOT reachable via `release(name, 0)`: that decrements for real on the binary
   * types (and returns false without granting at all when inUse is already 0), which is the
   * opposite of "grant only what the current counters already allow".
   *
   * A no-op for `sync` (its matching happens at enqueue time — send/receive/synchronize — so
   * there is no separate grant pass to run) and for an unknown key (never registered here, or
   * a type snapshotToSerialized could not model): callers sweep names the registry named, and
   * a name this manager was never hydrated for has no queue to grant from.
   */
  runGrantPass(resourceKey: string): void {
    const r = this.resources.get(resourceKey);
    if (!r) return;
    switch (r.type) {
      case 'binary exclusive use': this.tryGrantBinaryExclusive(r); break;
      case 'binary shared use with pool limits': this.tryGrantBinaryShared(r); break;
      case 'countable use with pool limits': this.tryGrantCountable(r); break;
      case 'named pool': this.tryGrantNamed(r); break;
      default: break;
    }
  }

  getSnapshot(): ResourceSnapshotEntry[] {
    const result: ResourceSnapshotEntry[] = [];
    for (const [key, r] of this.resources) {
      // Strip the OWNER prefix rather than splitting at the first ':' (spec §12.3 item 17):
      // every registration keys `${ownerId}:${name}` (instance.ts, transition.ts), while a
      // Phase 2a environment entry is keyed by its BARE name and owned by the work center —
      // and a bare name may itself contain ':'.
      const prefix = `${r.ownerId}:`;
      const resourceName = key.startsWith(prefix) ? key.substring(prefix.length) : key;
      const summary = summarizeResource(summaryInputOf(r));
      result.push({
        name: key,
        ownerId: r.ownerId,
        scope: r.scope,
        resourceName,
        type: r.type,
        total: summary.total,
        inUse: summary.inUse,
        available: summary.available,
        queued: summary.queued,
        queuedAcquires: summary.queued,
        state: summary.state,
      });
    }
    return result;
  }

  resetResources(resourceKeys: Set<string>): string[] {
    const reset: string[] = [];
    for (const key of resourceKeys) {
      const state = this.resources.get(key);
      if (!state) continue;
      switch (state.type) {
        case 'binary exclusive use':
          if (state.inUse > 0) reset.push(key);
          state.inUse = 0;
          this.tryGrantBinaryExclusive(state);
          break;
        case 'binary shared use with pool limits':
          if (state.inUse > 0) reset.push(key);
          state.inUse = 0;
          this.tryGrantBinaryShared(state);
          break;
        case 'countable use with pool limits':
          if (state.inUse > 0) reset.push(key);
          state.inUse = 0;
          this.tryGrantCountable(state);
          break;
        case 'named pool':
          if (state.available.length !== state.originalNames.size) reset.push(key);
          state.available = [...state.originalNames];
          this.tryGrantNamed(state);
          break;
        case 'sync':
          state.sendQueue = [];
          state.receiveQueue = [];
          state.pendingSync = [];
          break;
      }
    }
    return reset;
  }

  // ── Serialization (adaptation beyond the reference) ──

  toJSON(): SerializedResources {
    const resources: [string, SerializedResourceState][] = [];
    for (const [key, state] of this.resources) {
      resources.push([key, stateToJSON(state)]);
    }
    return {
      resources,
      pendingGrants: this.pendingGrants.map(g => ({ ...g })),
      syncMatchedData: [...this.syncMatchedData],
      pendingNamedAssignments: [...this.pendingNamedAssignments],
    };
  }

  static fromJSON(json: SerializedResources): InMemoryResourceManager {
    const mgr = new InMemoryResourceManager();
    for (const [key, state] of json.resources) {
      mgr.resources.set(key, stateFromJSON(state));
    }
    mgr.pendingGrants = json.pendingGrants.map(g => ({ ...g }));
    mgr.syncMatchedData = new Map(json.syncMatchedData);
    mgr.pendingNamedAssignments = new Map(json.pendingNamedAssignments);
    return mgr;
  }
}

// ── Resource command helpers (transcribed from resource-helpers.ts) ──

const ACTIVATION_COMMANDS = new Set([
  'Acquire', 'Acquire Pool Amount', 'Send', 'Receive', 'Synchronize',
]);

const SYNC_COMMANDS = new Set(['Send', 'Receive', 'Synchronize']);

export function splitResourceCommands(
  commands: ResourceCommandSpecification[],
): { activation: ResourceCommandSpecification[]; completion: ResourceCommandSpecification[] } {
  const activation: ResourceCommandSpecification[] = [];
  const completion: ResourceCommandSpecification[] = [];
  for (const cmd of commands) {
    if (ACTIVATION_COMMANDS.has(cmd.command_type)) {
      activation.push(cmd);
    } else {
      completion.push(cmd);
    }
  }
  return { activation, completion };
}

export function sortActivationCommands(
  commands: ResourceCommandSpecification[],
): ResourceCommandSpecification[] {
  return [...commands].sort((a, b) => {
    const aIsSync = SYNC_COMMANDS.has(a.command_type) ? 0 : 1;
    const bIsSync = SYNC_COMMANDS.has(b.command_type) ? 0 : 1;
    if (aIsSync !== bIsSync) return aIsSync - bIsSync;
    return a.resource_name.localeCompare(b.resource_name);
  });
}
