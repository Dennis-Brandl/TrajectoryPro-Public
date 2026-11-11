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

// Audit 2026-10-20 DB-scale H5: SCRIPT and GATE code used to run with vm.runInNewContext on the
// engine's own thread, inside the claim transaction, so a slow or looping script (up to its
// timeout) froze every other runtime on this replica. Scripts now run on a small pool of
// worker threads; the engine's thread only waits for the answer.
//
// The worker body is plain JavaScript evaluated from a string (eval: true), so it needs no
// separate file in the bundle (engine.mjs) or in tests. It runs exactly what the engine ran
// before — the fixed wrapper, string-only sandbox data, the vm timeout with microtaskMode
// 'afterEvaluate' — and returns either the wrapper's string or an error message built with
// the same rules as step-handlers' scriptErrorMessage. A script's leftover rejected promise
// is dropped there, in the worker, and can never reach the engine process.

import { Worker } from 'node:worker_threads';

/** What one sandbox run produced: the wrapper's JSON string (or null when it returned anything
 *  else), or a user-facing error message. */
export type SandboxOutcome = { raw: string | null; error?: undefined } | { raw?: undefined; error: string };

/** A worker that does not answer within the script timeout plus this grace is ended and
 *  replaced (the vm timeout normally answers first; this is a backstop). */
const BACKSTOP_GRACE_MS = 2000;
/** Heap cap per script worker: a script that allocates without bound fails its step instead of
 *  taking the engine's memory. */
const WORKER_HEAP_MB = 256;

const WORKER_SOURCE = `
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const { types } = require('node:util');
const UNREADABLE = workerData.unreadable;

process.on('unhandledRejection', () => {
  console.warn('[script] a script left a rejected promise unhandled; ignored');
});

function protoChainReaches(obj, target) {
  let p = obj;
  for (let depth = 0; depth < 16; depth++) {
    if (p === null || typeof p !== 'object' || types.isProxy(p)) return false;
    p = Object.getPrototypeOf(p);
    if (p === target) return true;
  }
  return false;
}
function ownDataString(obj, key) {
  if (obj === null || typeof obj !== 'object' || types.isProxy(obj)) return undefined;
  const d = Object.getOwnPropertyDescriptor(obj, key);
  return d && 'value' in d && typeof d.value === 'string' ? d.value : undefined;
}
function errorMessage(err) {
  if (typeof err === 'string') return err;
  if (!types.isNativeError(err) || types.isProxy(err)) return UNREADABLE;
  const message = ownDataString(err, 'message');
  if (message === undefined) return UNREADABLE;
  if (protoChainReaches(err, Error.prototype)) return message;
  const name = ownDataString(Object.getPrototypeOf(err), 'name');
  return (name === undefined ? 'Error' : name) + ': ' + message;
}

parentPort.on('message', (job) => {
  let reply;
  try {
    const sandbox = Object.create(null);
    Object.assign(sandbox, job.data);
    const raw = vm.runInNewContext(job.wrapper, sandbox, { timeout: job.timeoutMs, microtaskMode: 'afterEvaluate' });
    reply = { raw: typeof raw === 'string' ? raw : null };
  } catch (err) {
    reply = { error: errorMessage(err) };
  }
  parentPort.postMessage(reply);
});
`;

interface Job {
  wrapper: string;
  data: Record<string, string>;
  timeoutMs: number;
  resolve: (o: SandboxOutcome) => void;
}

interface Slot {
  worker: Worker | null;
  job: Job | null;
  backstop: ReturnType<typeof setTimeout> | null;
}

export class ScriptPool {
  private readonly slots: Slot[];
  private readonly queue: Job[] = [];

  constructor(size: number, private readonly unreadableMessage: string) {
    this.slots = Array.from({ length: Math.max(1, Math.floor(size)) }, () => ({ worker: null, job: null, backstop: null }));
  }

  get size(): number {
    return this.slots.length;
  }

  run(wrapper: string, data: Record<string, string>, timeoutMs: number): Promise<SandboxOutcome> {
    return new Promise(resolve => {
      this.queue.push({ wrapper, data, timeoutMs, resolve });
      this.dispatch();
    });
  }

  /** Ends every worker (tests, shutdown). Queued and running jobs resolve with an error. */
  async close(): Promise<void> {
    for (const job of this.queue.splice(0)) job.resolve({ error: 'Script engine shut down' });
    await Promise.all(this.slots.map(slot => this.finish(slot, { error: 'Script engine shut down' }, true)));
  }

  private dispatch(): void {
    for (const slot of this.slots) {
      if (this.queue.length === 0) return;
      if (slot.job) continue;
      const job = this.queue.shift()!;
      const worker = slot.worker ?? this.spawn(slot);
      slot.job = job;
      worker.ref(); // a running script keeps the process alive until it answers
      slot.backstop = setTimeout(() => {
        void this.finish(slot, { error: `Error: Script execution timed out after ${job.timeoutMs}ms` }, true);
      }, job.timeoutMs + BACKSTOP_GRACE_MS);
      worker.postMessage({ wrapper: job.wrapper, data: job.data, timeoutMs: job.timeoutMs });
    }
  }

  private spawn(slot: Slot): Worker {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { unreadable: this.unreadableMessage },
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
      // The worker needs nothing from the engine's environment (database URL, tokens).
      env: {},
    });
    worker.unref();
    worker.on('message', (reply: { raw?: unknown; error?: unknown }) => {
      if (slot.worker !== worker) return;
      const outcome: SandboxOutcome =
        typeof reply.error === 'string' ? { error: reply.error } : { raw: typeof reply.raw === 'string' ? reply.raw : null };
      void this.finish(slot, outcome, false);
    });
    worker.on('error', (err: Error & { code?: string }) => {
      if (slot.worker !== worker) return;
      const message = err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'Script ran out of memory' : 'Script stopped unexpectedly';
      void this.finish(slot, { error: message }, true);
    });
    worker.on('exit', () => {
      if (slot.worker !== worker) return;
      void this.finish(slot, { error: 'Script stopped unexpectedly' }, true);
    });
    slot.worker = worker;
    return worker;
  }

  /** Resolves the slot's job (if any) and frees the slot; `discard` also ends its worker so the
   *  next job gets a fresh one. */
  private async finish(slot: Slot, outcome: SandboxOutcome, discard: boolean): Promise<void> {
    if (slot.backstop) clearTimeout(slot.backstop);
    slot.backstop = null;
    const job = slot.job;
    slot.job = null;
    const worker = slot.worker;
    if (discard) slot.worker = null;
    else worker?.unref();
    job?.resolve(outcome);
    if (discard && worker) await worker.terminate().catch(() => undefined);
    this.dispatch();
  }
}

let shared: ScriptPool | null = null;
let sharedSize = 4;

/** Sets the shared pool's size (the engine passes ENGINE_WORKER_CONCURRENCY: one script per
 *  runtime it can work on at once). Takes effect for a pool not yet started. */
export function configureScriptPool(size: number): void {
  sharedSize = size;
}

export function scriptPool(unreadableMessage: string): ScriptPool {
  shared ??= new ScriptPool(sharedSize, unreadableMessage);
  return shared;
}
