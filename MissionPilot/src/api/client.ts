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
import type { InboxSnapshot, Me, WorkCenter, SubmitBody, PilotRuntimeWorkflow, RuntimeWorkflowDiagram, RuntimeWorkflowLiveStates } from './types'

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code?: string, message?: string) {
    super(message ?? `HTTP ${status}`)
    this.name = 'ApiError'
  }
}

// With opts.timeoutMs the fetch is aborted after that long (an AbortController + setTimeout, so
// fake timers can drive it); the abort rejects with a non-ApiError, which callers treat as "unreachable".
async function request<T>(path: string, init?: RequestInit, opts?: { timeoutMs?: number }): Promise<T> {
  const controller = opts?.timeoutMs !== undefined ? new AbortController() : undefined
  const timer = controller ? setTimeout(() => controller.abort(), opts!.timeoutMs) : undefined
  try {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
      ...init,
      ...(controller ? { signal: controller.signal } : {}),
    })
    if (res.status === 401) {
      window.dispatchEvent(new Event('pilot:unauthenticated'))
      throw new ApiError(401)
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string }
      throw new ApiError(res.status, body.code, body.error)
    }
    // 204 and empty bodies: return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const post = (path: string, body?: unknown, opts?: { timeoutMs?: number }) =>
  request(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }, opts)

const AUTH_TIMEOUT_MS = 15_000

export const api = {
  signIn: (email: string, password: string) => post('/api/auth/sign-in/email', { email, password }, { timeoutMs: AUTH_TIMEOUT_MS }),
  me: (opts?: { timeoutMs?: number }) => request<Me>('/api/me', undefined, opts),
  workCenters: () => request<WorkCenter[]>('/api/work-centers'),
  inbox: (wcId: string) => request<InboxSnapshot>(`/api/inbox?workCenterId=${encodeURIComponent(wcId)}`),
  claim: (id: string) => post(`/api/assignments/${id}/claim`),
  continueStep: (instanceId: string, stepInstanceId: string, reason?: string) =>
    post(`/api/runtime-workflows/${encodeURIComponent(instanceId)}/steps/${encodeURIComponent(stepInstanceId)}/continue`, reason ? { reason } : {}),
  release: (id: string) => post(`/api/assignments/${id}/release`),
  submit: (id: string, body: SubmitBody) => post(`/api/assignments/${id}/submit`, body),
  enterPresence: (wcId: string) => post('/api/presence', { workCenterId: wcId }),
  heartbeat: (status?: 'away' | 'back') => post('/api/presence/heartbeat', status ? { status } : {}),
  leavePresence: (wcId?: string) =>
    request(wcId ? `/api/presence?workCenterId=${encodeURIComponent(wcId)}` : '/api/presence', { method: 'DELETE' }),
  logout: () => post('/api/logout', undefined, { timeoutMs: AUTH_TIMEOUT_MS }),
  runtimeWorkflows: (wcId: string) =>
    request<PilotRuntimeWorkflow[]>(`/api/work-centers/${encodeURIComponent(wcId)}/runtime-workflows`),
  runtimeDiagram: (id: string) =>
    request<RuntimeWorkflowDiagram>(`/api/runtime-workflows/${encodeURIComponent(id)}/diagram`),
  runtimeLiveStates: (id: string) =>
    request<RuntimeWorkflowLiveStates>(`/api/runtime-workflows/${encodeURIComponent(id)}/live-states`),
}
