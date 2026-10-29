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
import type { MiddlewareHandler } from 'hono';
import { httpError } from '../lib/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same shape rule as requireUuidParams below, exposed for request-BODY fields that
// reference a uuid-typed DB column (e.g. POST { workflowId }) — those aren't route
// params, so the requireUuidParams middleware can't reach them; handlers call this
// directly after their own presence check.
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// Guards route params that back a uuid-typed DB column. Without this, a malformed
// param (e.g. "not-a-uuid") reaches the DAO and the Postgres driver rejects it with
// a raw error that falls through to app.onError as a generic 500 — instead of the
// handler's own 4xx logic (404/etc for a well-formed-but-missing id). Reusable across
// routes' :id / :workflowId / :userId / :envId / :linkId params.
export function requireUuidParams(...names: string[]): MiddlewareHandler {
  return async (c, next) => {
    for (const name of names) {
      const value = c.req.param(name);
      if (value !== undefined && !isUuid(value)) {
        return httpError(c, 400, 'validation', `Invalid ${name}: must be a UUID`);
      }
    }
    await next();
  };
}
