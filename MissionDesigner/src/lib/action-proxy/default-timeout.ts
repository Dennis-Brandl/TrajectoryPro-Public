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

/** The authored deadline, or none — the engine reads a missing timeout_ms as no limit. */
export function proxyTimeoutMs(authored: number | undefined): number | undefined {
  return authored
}

/** Copy of config with timeout_ms set, or with the key removed when timeoutMs is undefined. */
export function setProxyTimeout<T extends { timeout_ms?: number }>(config: T, timeoutMs: number | undefined): T {
  const { timeout_ms: _drop, ...rest } = config
  void _drop
  return (timeoutMs === undefined ? rest : { ...rest, timeout_ms: timeoutMs }) as T
}

/** '' → no limit; whole seconds ≥ 1 (after trim) → ms; anything else → not ok. */
export function parseTimeLimitSeconds(text: string): { ok: true; timeoutMs: number | undefined } | { ok: false } {
  const t = text.trim()
  if (t === '') return { ok: true, timeoutMs: undefined }
  if (!/^\d+$/.test(t)) return { ok: false }
  const n = Number(t)
  if (!Number.isSafeInteger(n) || n < 1) return { ok: false }
  return { ok: true, timeoutMs: n * 1000 }
}

/** undefined → ''; otherwise String(ms / 1000). */
export function formatTimeLimitSeconds(timeoutMs: number | undefined): string {
  return timeoutMs === undefined ? '' : String(timeoutMs / 1000)
}
