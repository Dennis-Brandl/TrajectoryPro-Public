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
import { get, post, patch } from './client';
import type { AppUser, UserView } from './types';
import type { AccessLevel } from '@/lib/access-levels';
export type CreateUserInput = { email: string; displayName: string; password: string; loginName: string; accessLevel?: AccessLevel };
export type UpdateUserInput = { displayName?: string; loginName?: string; email?: string };
export const users = {
  // Same endpoint as pickers.users(); named here so the Users hierarchy owns its list.
  list: () => get('/api/users') as Promise<{ users: AppUser[] }>,
  get: (id: string) => get(`/api/users/${id}`) as Promise<UserView>,
  create: (input: CreateUserInput) => post('/api/users', input) as Promise<UserView>,
  update: (id: string, body: UpdateUserInput) => patch(`/api/users/${id}`, body) as Promise<UserView>,
  setPassword: (id: string, newPassword: string) => post(`/api/users/${id}/password`, { newPassword }) as Promise<{ ok: true }>,
  setAccess: (id: string, accessLevel: AccessLevel) => post(`/api/users/${id}/access`, { accessLevel }) as Promise<UserView>,
  setStatus: (id: string, status: 'active' | 'disabled') => post(`/api/users/${id}/status`, { status }) as Promise<UserView>,
  // Role membership is edited on the work center (workCenters.setUserRoles) — spec 2026-09-06 D3.
};
