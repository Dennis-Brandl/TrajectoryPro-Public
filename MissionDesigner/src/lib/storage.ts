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

import { get, set, del } from 'idb-keyval'
import type { StateStorage } from 'zustand/middleware'

/**
 * IndexedDB storage adapter for Zustand persist middleware.
 * Uses idb-keyval for simple key-value operations.
 *
 * Benefits over localStorage:
 * - 50MB+ storage (vs 5MB localStorage)
 * - Async (doesn't block main thread)
 * - Better for large workflow data
 */
export const indexedDBStorage: StateStorage = {
  getItem: async (name: string) => {
    const value = await get(name)
    return value ?? null
  },
  setItem: async (name: string, value: string) => {
    await set(name, value)
  },
  removeItem: async (name: string) => {
    await del(name)
  },
}
