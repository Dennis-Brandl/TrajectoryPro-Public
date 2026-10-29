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

import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  // Use current origin - Vite proxy will forward /api/* to backend
  baseURL: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
})

export const { signIn, signUp, signOut, useSession } = authClient
