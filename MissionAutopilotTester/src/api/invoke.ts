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

import type { Connection, InvokeRequestBody, InvokeResponse } from './types'
import { ApiError } from './types'

export async function invokeAction(
  connection: Connection,
  actionOid: string,
  body: InvokeRequestBody
): Promise<InvokeResponse['data']> {
  const baseUrl = connection.url.replace(/\/+$/, '')
  const url = `${baseUrl}/trajectory/v1/actions/${actionOid}/invoke`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (connection.apiKey) {
    headers.Authorization = `Bearer ${connection.apiKey}`
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const responseBody = await response.text().catch(() => '')
    throw new ApiError(response.status, response.statusText, responseBody)
  }
  const parsed = (await response.json()) as InvokeResponse
  return parsed.data
}
