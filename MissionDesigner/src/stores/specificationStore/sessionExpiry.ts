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

// Phase 35 §4.6: session expiry helpers. Detect 401 errors, stash pending retry
// ids so the edit-lock releases, and clear the retry set after re-login succeeds.

import { useSpecificationStore } from '../specificationStore'
import { ApiError } from './apiClient'

export function isSessionExpiryError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401
}

export function stashPendingRetry(specIds: string[]): void {
  useSpecificationStore.setState((s) => {
    for (const id of specIds) s.pendingRetryIds.add(id)
    // Clear savingIds so the edit-lock releases
    for (const id of specIds) s.savingIds.delete(id)
  })
}

export function clearPendingRetry(): void {
  useSpecificationStore.setState((s) => s.pendingRetryIds.clear())
}
