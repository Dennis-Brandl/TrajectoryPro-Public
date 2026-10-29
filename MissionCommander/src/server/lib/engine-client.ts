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
// Phase 6 (spec §5): the CM-server → engine internal-API client. Env is read per call, not at
// module load, so tests can stub it and a compose restart with new env needs no code reload
// ceremony. The engine's own token gate fails closed; an unset token here simply produces
// 401s that surface as engine errors — never a silent bypass.
//
// Phase 4b (spec §7.2): the operator verbs answer `{ ok, summary, … }`; `engineVerb` keeps the
// summary (engine wording, kept for logs and tests — the panes toast their own copy, D24) while
// the Phase 6 controls keep answering a bare `{ ok: true }`.
import type { ResourceVerb } from './shared-state-bodies';

export class EngineUnavailableError extends Error {}

export type EngineResult = { ok: true } | { ok: false; status: number; message: string };
export type EngineVerbResult = { ok: true; summary: string } | { ok: false; status: number; message: string };

export type WorkCenterResourceVerbBody = { name: string; holderId?: number; waiterId?: number; amount?: number; poolName?: string; actorUserId: string };
/** D16: `waiterId` is an environment waiter ROW id (number) or a workflow-tier STEP oid (string). */
export type InstanceResourceVerbBody = { resourceKey: string; holderId?: number; waiterId?: number | string; amount?: number; poolName?: string; actorUserId: string };
export type WorkCenterValueBody = { propertyName: string; entryName: string; value: string; actorUserId: string };
export type InstanceValueBody = { specOid?: string; key: string; value: string; actorUserId: string };

async function engineFetch(path: string, body?: unknown): Promise<Response> {
  const baseUrl = process.env.ENGINE_BASE_URL || 'http://127.0.0.1:3006';
  const token = process.env.ENGINE_INTERNAL_TOKEN ?? '';
  try {
    return await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'x-internal-token': token,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw new EngineUnavailableError(err instanceof Error ? err.message : String(err));
  }
}

async function engineFailure(res: Response): Promise<{ ok: false; status: number; message: string }> {
  const resBody = await res.json().catch(() => null) as { error?: { message?: string } } | null;
  return { ok: false, status: res.status, message: resBody?.error?.message || `engine error ${res.status}` };
}

async function enginePost(path: string, body?: unknown): Promise<EngineResult> {
  const res = await engineFetch(path, body);
  if (res.ok) return { ok: true };
  return engineFailure(res);
}

async function engineVerb(path: string, body: unknown): Promise<EngineVerbResult> {
  const res = await engineFetch(path, body);
  if (!res.ok) return engineFailure(res);
  const okBody = await res.json().catch(() => null) as { summary?: unknown } | null;
  return { ok: true, summary: typeof okBody?.summary === 'string' ? okBody.summary : 'Done' };
}

export const engineControl = (verb: 'pause' | 'resume' | 'stop' | 'abort', instanceId: string): Promise<EngineResult> =>
  enginePost(`/internal/instances/${instanceId}/${verb}`);

export const engineForceRelease = (assignmentId: string): Promise<EngineResult> =>
  enginePost(`/internal/assignments/${assignmentId}/force-release`);

export const engineAssign = (assignmentId: string, userId: string): Promise<EngineResult> =>
  enginePost(`/internal/assignments/${assignmentId}/assign`, { userId });

// Phase 4b (spec §7.1 as-built): the four operator writes. The verb is a route segment, never
// user input — the route files iterate RESOURCE_VERBS, so an unknown verb is simply no route.
export const engineWorkCenterResourceVerb = (workCenterId: string, verb: ResourceVerb, body: WorkCenterResourceVerbBody): Promise<EngineVerbResult> =>
  engineVerb(`/internal/work-centers/${workCenterId}/resources/${verb}`, body);

export const engineInstanceResourceVerb = (instanceId: string, verb: ResourceVerb, body: InstanceResourceVerbBody): Promise<EngineVerbResult> =>
  engineVerb(`/internal/instances/${instanceId}/resources/${verb}`, body);

export const engineSetWorkCenterValue = (workCenterId: string, body: WorkCenterValueBody): Promise<EngineVerbResult> =>
  engineVerb(`/internal/work-centers/${workCenterId}/value-properties`, body);

export const engineSetInstanceValue = (instanceId: string, body: InstanceValueBody): Promise<EngineVerbResult> =>
  engineVerb(`/internal/instances/${instanceId}/value-properties`, body);

// Spec 2026-10-13 §5.2: force a waiting gate. The engine re-checks state under the instance lock.
export const engineForceComplete = (instanceId: string, stepInstanceId: string, body: { actorUserId: string; reason: string }): Promise<EngineVerbResult> =>
  engineVerb(`/internal/instances/${instanceId}/steps/${stepInstanceId}/force-complete`, body);
