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
import { Hono } from 'hono'

/**
 * Helper to make test requests against a Hono app without starting an HTTP server.
 * Uses Hono's built-in app.request() method.
 */
export function createTestClient(app: Hono) {
  const baseUrl = 'http://localhost'

  return {
    get(path: string, opts?: { headers?: Record<string, string> }) {
      return app.request(`${baseUrl}${path}`, {
        method: 'GET',
        headers: opts?.headers,
      })
    },

    post(path: string, body?: unknown, opts?: { headers?: Record<string, string> }) {
      return app.request(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...opts?.headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    },

    put(path: string, body?: unknown, opts?: { headers?: Record<string, string> }) {
      return app.request(`${baseUrl}${path}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...opts?.headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    },

    patch(path: string, body?: unknown, opts?: { headers?: Record<string, string> }) {
      return app.request(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...opts?.headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    },

    delete(path: string, opts?: { headers?: Record<string, string> }) {
      return app.request(`${baseUrl}${path}`, {
        method: 'DELETE',
        headers: opts?.headers,
      })
    },
  }
}
