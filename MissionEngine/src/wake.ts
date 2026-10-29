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
import pg from 'pg';

const RECONNECT_BACKOFF_MS = 5000;

export interface WakeListenerHandle {
  /** End the listener's connection without triggering a reconnect. */
  stop: () => void;
}

/**
 * LISTEN `channel` on a dedicated pg.Client (never share the pool — LISTEN/NOTIFY needs a
 * long-lived session, and pooled connections get recycled) and call `onWake(payload)` for every
 * notification. Reconnects with a flat 5s backoff on connection error/close.
 *
 * `channel` comes only from our own constants (`'engine_wake'`'s default, or a caller-supplied
 * constant like `OPERATOR_CHANGE_CHANNEL`) — never user input — so interpolating it directly
 * into `LISTEN ${channel}` is safe; Postgres's `LISTEN` statement doesn't accept a bind
 * parameter for the channel name.
 *
 * Production-only; never used in tests via this pg.Client path — unit tests either poll runOnce
 * directly via pumpUntilQuiet, or (Task 11's NOTIFY-payload pin) LISTEN through PGlite's own
 * `.listen()` JS API directly on its raw client, which this module has no involvement in.
 */
export function createWakeListener(
  databaseUrl: string,
  onWake: (payload?: string) => void,
  channel = 'engine_wake',
): WakeListenerHandle {
  let stopped = false;
  let client: pg.Client | null = null;

  function connect(): void {
    if (stopped) return;
    const c = new pg.Client({ connectionString: databaseUrl });
    client = c;
    // error, end and a failed connect()/LISTEN can all fire for one dead client: only the first
    // schedules a reconnect, or each failure would multiply the LISTEN connections.
    let retried = false;
    const retry = (): void => {
      if (retried) return;
      retried = true;
      if (stopped) return;
      if (client === c) client = null;
      c.removeAllListeners();
      // A late 'error' on the discarded client must not become an unhandled event (process exit).
      c.on('error', () => {});
      c.end().catch(() => {});
      setTimeout(connect, RECONNECT_BACKOFF_MS);
    };
    c.on('notification', (msg) => onWake(msg.payload));
    c.on('error', retry);
    c.on('end', retry);
    c.connect()
      .then(() => c.query(`LISTEN ${channel}`))
      .catch(retry);
  }

  connect();

  return {
    stop(): void {
      stopped = true;
      if (client) {
        client.removeAllListeners();
        client.on('error', () => {});
        client.end().catch(() => {});
        client = null;
      }
    },
  };
}
