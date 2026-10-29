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
export class ApiError extends Error {
  // `body` is the whole parsed error payload, not just code/message. M6's two-call
  // work-center delete answers 409 with an `impact` summary alongside them, and
  // DeleteWorkCenterDialog renders those counts — without retaining the body there is no
  // way to reach them, and the loss is silent because status and message still look right.
  constructor(public status: number, public code: string, message: string, public body?: unknown) {
    super(message || code);
    this.name = 'ApiError';
  }
}
export function apiErrorMessage(err: unknown, fallback: string): string {
  // Only an ApiError carries a server-authored message worth surfacing to the user;
  // any other Error (network failure, programming error, etc.) falls back, so we don't
  // leak an internal/local message. (The brief's reference impl here had a fall-through
  // `err instanceof Error ? err.message : fallback` branch that returned the raw message
  // for ANY Error — that contradicts this file's own Step-1 test, which asserts
  // apiErrorMessage(new Error('boom'), 'fallback') === 'fallback'. Fixed to match the test.)
  if (err instanceof ApiError) return err.message || fallback;
  return fallback;
}
/**
 * Routes that are reachable WITHOUT a session. A 401 raised while on one of these must
 * not trigger the redirect below, or the document reloads in a loop.
 */
export function isUnauthenticatedRoute(pathname: string): boolean {
  return pathname === '/login' || pathname === '/setup';
}

/**
 * A 401 from /api/* means exactly one thing here: the session is gone. It is worth being
 * precise about why we can act on it so bluntly — server-side, `requireSession` is the ONLY
 * source of 401 (src/server/middleware/auth.ts); every permission denial is 403. So a 401
 * never means "signed in but not allowed", and treating it as "signed out" is unambiguous.
 *
 * This has to live at the fetch layer rather than in the router. `_authenticated`'s
 * beforeLoad guard only re-runs on NAVIGATION, so a tab left open across a session loss
 * kept rendering: its mounted panels refetched, toasted the server's "Authentication
 * required", and left every pane empty, with nothing ever routing to /login.
 *
 * A hard document navigation (not a router push) is deliberate — it re-runs the whole
 * guard chain from a clean slate and drops the stale in-memory stores a client-side
 * transition would otherwise keep.
 */
function goToLogin(): void {
  if (typeof window === 'undefined') return;
  if (isUnauthenticatedRoute(window.location.pathname)) return;
  window.location.assign('/login');
}

let onUnauthorized: () => void = goToLogin;
/** Override the 401 reaction (tests). Pass null to restore the default redirect. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn ?? goToLogin;
}

async function handle(res: Response) {
  // Fires before the 204/ok branches so EVERY verb funnels through it, including the
  // multipart upload path. Still throws below: an in-flight caller gets to run its own
  // error handling while the document navigates away.
  if (res.status === 401) onUnauthorized();
  if (res.status === 204) return undefined;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(res.status, e?.code ?? 'internal', e?.message ?? '', body);
  }
  return body;
}
const json = (method: string, body?: unknown): RequestInit => ({
  method, credentials: 'include',
  ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
});
export const get = (p: string) => fetch(p, { credentials: 'include' }).then(handle);
export const post = (p: string, b?: unknown) => fetch(p, json('POST', b)).then(handle);
export const patch = (p: string, b?: unknown) => fetch(p, json('PATCH', b)).then(handle);
export const put = (p: string, b?: unknown) => fetch(p, json('PUT', b)).then(handle);
export const del = (p: string) => fetch(p, json('DELETE')).then(handle);
// Multipart upload — the only verb that does NOT go through `json()` above. The
// content-type header is deliberately omitted: the browser sets it itself, including the
// `boundary=…` the server needs to parse the parts. Hand-setting it breaks the upload.
export const postForm = (p: string, form: FormData) =>
  fetch(p, { method: 'POST', credentials: 'include', body: form }).then(handle);
