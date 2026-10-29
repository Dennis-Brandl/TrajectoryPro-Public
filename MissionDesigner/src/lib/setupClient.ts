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

// Public first-run status (design §3.2). No admin envelope — a plain fetch the
// /setup route guard (Slice 2) calls before any session exists.

export interface SetupStatus {
  setupComplete: boolean
  hasAdmin: boolean
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const res = await fetch('/api/setup-status', { credentials: 'include' })
  if (!res.ok) throw new Error(`setup-status ${res.status}`)
  return (await res.json()) as SetupStatus
}
