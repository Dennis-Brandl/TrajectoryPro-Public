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
import type { Context } from 'hono';
import { httpError } from './errors';
import { EngineUnavailableError, type EngineResult, type EngineVerbResult } from './engine-client';

// Phase 6's engine → CM envelope mapping, hoisted out of routes/runtime-workflows.ts for Phase
// 4b's routes (spec §7.2, "reusing engineResultResponse and EngineUnavailableError mapping
// verbatim"): 404 → not_found, 409 → conflict, anything else → 502; unreachable → 502 with a
// fixed message. The CM never inspects the engine's `code` — only the status and the message.
export const ENGINE_UNREACHABLE = 'Engine unreachable — try again';

export function engineResultResponse(c: Context, result: { ok: false; status: number; message: string }, fallback: string): Response {
  if (result.status === 404) return httpError(c, 404, 'not_found', result.message || fallback);
  if (result.status === 409) return httpError(c, 409, 'conflict', result.message || fallback);
  return httpError(c, 502, 'internal', result.message || fallback);
}

/** Runs one engine call and maps its outcome. A verb result carries the engine's summary through
 *  as `{ ok: true, summary }`; a Phase 6 control result answers `{ ok: true }` as before. */
export async function proxyEngine(c: Context, call: () => Promise<EngineResult | EngineVerbResult>, fallback: string): Promise<Response> {
  try {
    const result = await call();
    if (result.ok) return c.json('summary' in result ? { ok: true, summary: result.summary } : { ok: true });
    return engineResultResponse(c, result, fallback);
  } catch (err) {
    if (err instanceof EngineUnavailableError) return httpError(c, 502, 'internal', ENGINE_UNREACHABLE);
    throw err;
  }
}
