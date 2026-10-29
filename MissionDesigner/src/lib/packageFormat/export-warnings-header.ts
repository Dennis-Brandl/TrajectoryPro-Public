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

/**
 * GATE follow-up item 5 (server round-trip): the `.WFmasterX` export's response body is the
 * ZIP itself, so the builder's warnings (rule-4 gate-binding ambiguity, undecodable images)
 * ride back to the browser in one response header instead. Shared by the route that sets it
 * and the API client that reads it.
 *
 * Header field values must be ASCII, so the list is JSON then percent-encoded. A pathological
 * export is capped well under Node's 16 KB header limit: whole entries are kept in order and
 * one trailing entry names how many were dropped (the server log still has them all).
 */

export const EXPORT_WARNINGS_HEADER = 'x-export-warnings'
export const EXPORT_WARNINGS_MAX_ENCODED_LENGTH = 6144

function encodeList(list: readonly string[]): string {
  return encodeURIComponent(JSON.stringify(list))
}

function overflowEntry(dropped: number): string {
  return `+${dropped} more, see the server log`
}

/** Returns the header value, or undefined when there is nothing to report (no header at all). */
export function encodeExportWarnings(warnings: readonly string[]): string | undefined {
  if (warnings.length === 0) return undefined
  const full = encodeList(warnings)
  if (full.length <= EXPORT_WARNINGS_MAX_ENCODED_LENGTH) return full

  let keep = 0
  while (
    keep < warnings.length &&
    encodeList([...warnings.slice(0, keep + 1), overflowEntry(warnings.length - keep - 1)]).length <=
      EXPORT_WARNINGS_MAX_ENCODED_LENGTH
  ) {
    keep++
  }
  return encodeList([...warnings.slice(0, keep), overflowEntry(warnings.length - keep)])
}

/** Tolerant: an absent, empty, or malformed header decodes to an empty list. */
export function decodeExportWarnings(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value))
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string') ? parsed : []
  } catch {
    return []
  }
}
