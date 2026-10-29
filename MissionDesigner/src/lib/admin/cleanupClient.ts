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

import type { ScanEvent, ScanReport } from '../../server/admin/cleanup/types'

export interface StreamHandle {
  close: () => void
}

export function streamCleanupScan(onEvent: (evt: ScanEvent) => void): StreamHandle {
  // EventSource only supports GET; we want POST semantics for "start a scan".
  // Strategy: fire a POST that returns an SSE stream, consume via ReadableStream.
  const controller = new AbortController()
  void (async () => {
    try {
      const res = await fetch('/api/admin/cleanup/scan', {
        method: 'POST',
        signal: controller.signal,
        headers: { accept: 'text/event-stream' },
      })
      if (!res.ok || !res.body) {
        onEvent({ type: 'error', message: `Scan failed: HTTP ${res.status}` })
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        // SSE messages are separated by a blank line.
        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '))
          if (!dataLine) continue
          try {
            const evt = JSON.parse(dataLine.slice(6)) as ScanEvent
            onEvent(evt)
          } catch {
            // ignore malformed chunk
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return
      onEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  })()
  return { close: () => controller.abort() }
}

export async function fetchCleanupScanReport(scanId: string): Promise<ScanReport | null> {
  const res = await fetch(`/api/admin/cleanup/scans/${encodeURIComponent(scanId)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Scan report fetch failed: HTTP ${res.status}`)
  return (await res.json()) as ScanReport
}

export interface ApplyResponse {
  applied: number
  skipped: number
  failed: number
  results: Array<{ findingId: string; result: 'applied' | 'skipped' | 'failed'; message?: string }>
}

export async function applyCleanupFindings(scanId: string, findingIds: string[]): Promise<ApplyResponse> {
  const res = await fetch('/api/admin/cleanup/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scanId, findingIds }),
  })
  if (!res.ok) throw new Error(`Apply failed: HTTP ${res.status}`)
  return (await res.json()) as ApplyResponse
}
