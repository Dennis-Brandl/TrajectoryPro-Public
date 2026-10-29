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
import { buildInbox, type InboxSnapshot } from 'mission-control-db/src/runtime/inbox';
import type { Db } from '../db.js';

interface HubSession {
  userId: string;
  workCenterId: string;
  send: (snapshot: InboxSnapshot) => void;
  /** Spec 2026-10-09 §13: a theme was saved; the Pilot refetches /api/theme. */
  sendTheme?: (rev: number) => void;
}

/** Full-snapshot SSE fan-out (spec F8): one registry per engine process; every replica serves
 *  its own connections. Debounce coalesces bursts (a cascade parks several steps in one
 *  transaction -> one push). */
export class OperatorEventHub {
  private sessions = new Map<string, HubSession>();
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private db: Db, private debounceMs = 100) {}

  register(key: string, session: HubSession): void { this.sessions.set(key, session); }
  unregister(key: string): void { this.sessions.delete(key); }
  get sessionCount(): number { return this.sessions.size; }

  notifyWorkCenter(wcId: string): void {
    if (this.pending.has(wcId)) return;
    this.pending.set(wcId, setTimeout(() => { this.pending.delete(wcId); void this.push(wcId); }, this.debounceMs));
  }

  /** Every session, whatever its work center: the site theme reaches them all, and a
   *  work-center write bumps the same rev (spec §8.1). No debounce — a save is one event. */
  notifyTheme(rev: number): void {
    for (const [key, s] of this.sessions) {
      if (!s.sendTheme) continue;
      try { s.sendTheme(rev); }
      catch { this.sessions.delete(key); }
    }
  }

  private async push(wcId: string): Promise<void> {
    for (const [key, s] of this.sessions) {
      if (s.workCenterId !== wcId) continue;
      // A failed inbox build (a DB blip) says nothing about the connection: keep the session so
      // the next change reaches it. Only a failed send means the stream is gone.
      let snapshot: InboxSnapshot;
      try { snapshot = await buildInbox(this.db, s.userId, wcId); }
      catch (err) { console.error('[events] inbox build failed for', wcId, err); continue; }
      try { s.send(snapshot); }
      catch { this.sessions.delete(key); }
    }
  }
}
