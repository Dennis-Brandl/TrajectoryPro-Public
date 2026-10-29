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

// A short TTL cache over the trust-policy read. The engine asks for the policy on every
// action-server call; without this each call costs a DB round trip, and under load that read
// queues behind the pool. A Mission Commander change still reaches the engine within the TTL.
import type { ActionServerPolicySource } from './client.js';

type ActionServerPolicy = Awaited<ReturnType<ActionServerPolicySource>>;

export function cachedPolicySource(
  read: ActionServerPolicySource,
  opts: { ttlMs?: number; now?: () => number } = {},
): ActionServerPolicySource {
  const ttlMs = opts.ttlMs ?? 5000;
  const now = opts.now ?? Date.now;
  let value: ActionServerPolicy | null = null;
  let readAt = 0;
  let inflight: Promise<ActionServerPolicy> | null = null;
  return () => {
    if (value && now() - readAt <= ttlMs) return Promise.resolve(value);
    if (inflight) return inflight;
    const started = now();
    const p = read().then(
      (v) => { value = v; readAt = started; inflight = null; return v; },
      (err) => { inflight = null; throw err; },
    );
    inflight = p;
    return p;
  };
}
