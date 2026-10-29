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

import { describe, it, expect } from 'vitest';
import { cachedPolicySource } from '../src/actions/policy-cache.js';
import type { ActionServerPolicySource } from '../src/actions/client.js';

type ActionServerPolicy = Awaited<ReturnType<ActionServerPolicySource>>;

const policy = (): ActionServerPolicy => ({ trust: 'strict', allowlist: [] });

describe('cachedPolicySource', () => {
  it('reads once within the TTL', async () => {
    let t = 0; let reads = 0;
    const src = cachedPolicySource(async () => { reads++; return policy(); }, { now: () => t });
    await src(); t = 4999; await src();
    expect(reads).toBe(1);
  });

  it('re-reads after the TTL', async () => {
    let t = 0; let reads = 0;
    const src = cachedPolicySource(async () => { reads++; return policy(); }, { now: () => t });
    await src(); t = 5001; await src();
    expect(reads).toBe(2);
  });

  it('shares an in-flight read', async () => {
    let reads = 0; let release!: (p: ActionServerPolicy) => void;
    const src = cachedPolicySource(() => { reads++; return new Promise<ActionServerPolicy>((r) => { release = r; }); }, { now: () => 0 });
    const a = src(); const b = src();
    release(policy());
    const [pa, pb] = await Promise.all([a, b]);
    expect(reads).toBe(1);
    expect(pa).toBe(pb);
  });

  it('does not cache a failed read', async () => {
    let t = 0; let reads = 0;
    const src = cachedPolicySource(async () => { reads++; if (reads === 1) throw new Error('db down'); return policy(); }, { now: () => t });
    await expect(src()).rejects.toThrow('db down');
    t = 1;
    await expect(src()).resolves.toEqual(policy());
    expect(reads).toBe(2);
  });
});
