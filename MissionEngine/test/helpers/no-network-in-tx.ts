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
// Data-safety spec 2026-10-21: the engine must never make an action-server network call while it
// holds a locked transaction (plus a pooled connection) — under load that self-deadlocks the
// pool. These two proxies let a test prove it: `trackTransactions` counts open `db.transaction`
// callbacks, and `guardClient` makes every ActionClient call throw while that count is above 0.
import type { Db } from '../../src/db.js';
import type { ActionClient } from '../../src/actions/client.js';

/** Methods that are allowed inside a transaction: `peekCapabilities` reads only the client's
 *  in-memory cache and never touches the network. */
const EXEMPT_METHODS = new Set<string | symbol>(['peekCapabilities']);

/** A proxy of `db` whose `transaction(fn)` counts as open for the whole duration of `fn`. Every
 *  other property passes straight through to the real db. Nested `tx.transaction` savepoints are
 *  not counted separately — the outer transaction already is. */
export function trackTransactions(db: Db): { db: Db; openCount(): number } {
  let open = 0;
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === 'transaction') {
        return (fn: (tx: Db) => Promise<unknown>, config?: unknown) =>
          (target.transaction as (f: (tx: Db) => Promise<unknown>, c?: unknown) => Promise<unknown>)(
            async (tx) => {
              open++;
              try {
                return await fn(tx);
              } finally {
                open--;
              }
            },
            config,
          );
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { db: proxy, openCount: () => open };
}

/** A proxy of `client` that throws `ActionClient.<method> called inside a transaction` from every
 *  method except the exempt ones while `open() > 0`. The throw is synchronous on purpose: a
 *  rejected promise would be swallowed by the engine's many `.catch(() => {})` best-effort calls,
 *  hiding exactly the call this guard exists to catch. */
export function guardClient(client: ActionClient, open: () => number): ActionClient {
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (EXEMPT_METHODS.has(prop)) return value.bind(target);
      return (...args: unknown[]) => {
        if (open() > 0) throw new Error(`ActionClient.${String(prop)} called inside a transaction`);
        return value.apply(target, args);
      };
    },
  });
}
