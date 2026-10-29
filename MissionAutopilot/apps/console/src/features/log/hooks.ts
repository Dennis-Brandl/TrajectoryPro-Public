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

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { LogQueryParams } from '@/lib/types'

export function useLogEntries(params?: LogQueryParams) {
  return useQuery({
    queryKey: ['log', params],
    queryFn: () => api.logEntries(params),
  })
}

export function useLogEntry(id: number | null) {
  return useQuery({
    queryKey: ['log', id],
    queryFn: () => api.logEntry(id!),
    enabled: id !== null,
  })
}
