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

// Network-failure guards for the authenticated layout. better-fetch rejects on
// a network error, so a stopped server would otherwise abort sign-out and the
// boot sequence before the error screen can appear.

export async function signOutQuietly(signOut: () => Promise<unknown>): Promise<void> {
  try {
    await signOut()
  } catch {
    // Server unreachable: the session expires on its own.
  }
}

export async function getSessionOrUnreachable<T>(
  getSession: () => Promise<{ data: T | null }>,
): Promise<{ unreachable: true } | { unreachable: false; data: T | null }> {
  try {
    const session = await getSession()
    return { unreachable: false, data: session.data }
  } catch {
    return { unreachable: true }
  }
}
