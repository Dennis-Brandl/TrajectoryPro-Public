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
import { useCallback } from 'react';
import { runtimeWorkflows } from '@/lib/api/runtime-workflows';
import { usePolledView } from '@/lib/hooks/usePolledView';
import type { RuntimeListFilter } from '@/lib/api/types';

export const RUNTIME_LIST_POLL_MS = 5000;

export function useRuntimeWorkflows(workCenterId: string | null, filter: RuntimeListFilter, page: number) {
  const fetcher = useCallback(
    () => runtimeWorkflows.list(workCenterId!, { filter, page }),
    [workCenterId, filter, page],
  );
  return usePolledView(
    workCenterId === null ? null : `${workCenterId}:${filter}:${page}`,
    fetcher, 'Failed to load runtime workflows', RUNTIME_LIST_POLL_MS,
  );
}
