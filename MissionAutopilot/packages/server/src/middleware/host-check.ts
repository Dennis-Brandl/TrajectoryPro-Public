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

import type { RequestHandler } from 'express'

/** Hostname of a Host header value: port stripped, IPv6 brackets removed, lower-cased. */
function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return ''
  const h = hostHeader.trim().toLowerCase()
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    return end === -1 ? h : h.slice(1, end)
  }
  const colon = h.lastIndexOf(':')
  return colon === -1 ? h : h.slice(0, colon)
}

/**
 * Refuses requests whose Host is not in `hosts` (DNS-rebinding defence) or whose
 * Origin header is present and not allowed.
 */
export function createHostCheck(
  hosts: Set<string>,
  originAllowed: (origin: string) => boolean
): RequestHandler {
  return (req, res, next) => {
    if (!hosts.has(hostnameOf(req.headers.host))) {
      res
        .status(403)
        .json({ error: { code: 'FORBIDDEN_HOST', message: 'Host not allowed', details: {} } })
      return
    }
    const origin = req.headers.origin
    if (typeof origin === 'string' && !originAllowed(origin)) {
      res
        .status(403)
        .json({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Origin not allowed', details: {} } })
      return
    }
    next()
  }
}
