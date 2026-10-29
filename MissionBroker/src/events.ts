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

import type { SSEStreamingApi } from 'hono/streaming';

/** In-process SSE fan-out, keyed by action instance id. One engine stream per instance
 *  (MissionEngine actions/sse.ts); more are tolerated. */
export class EventHub {
  private subs = new Map<string, Set<SSEStreamingApi>>();
  private nextId = 1;

  subscribe(id: string, stream: SSEStreamingApi): () => void {
    const set = this.subs.get(id) ?? new Set<SSEStreamingApi>();
    this.subs.set(id, set);
    set.add(stream);
    return () => { set.delete(stream); if (set.size === 0) this.subs.delete(id); };
  }

  /** Open streams for one instance (0 once every client has disconnected). */
  subscriberCount(id: string): number {
    return this.subs.get(id)?.size ?? 0;
  }

  send(stream: SSEStreamingApi, id: string, state: string, previous: string | null): void {
    void stream.writeSSE({
      event: 'state_change', id: String(this.nextId++),
      data: JSON.stringify({ instance_id: id, state, previous_state: previous, timestamp: new Date().toISOString() }),
    });
  }

  publish(id: string, state: string, previous: string | null): void {
    for (const stream of this.subs.get(id) ?? []) this.send(stream, id, state, previous);
  }
}
