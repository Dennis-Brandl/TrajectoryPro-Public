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

import type { Connection, Instance, InstanceResponse } from './types'
import { ApiError } from './types'

export async function fetchInstance(connection: Connection, instanceId: string): Promise<Instance> {
  const baseUrl = connection.url.replace(/\/+$/, '')
  const url = `${baseUrl}/trajectory/v1/instances/${instanceId}`

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (connection.apiKey) {
    headers.Authorization = `Bearer ${connection.apiKey}`
  }

  const response = await fetch(url, { headers })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ApiError(response.status, response.statusText, body)
  }
  const parsed = (await response.json()) as InstanceResponse
  return parsed.data
}
