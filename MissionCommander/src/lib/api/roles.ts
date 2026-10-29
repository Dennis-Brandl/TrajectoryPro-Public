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
import { get, post, patch, del } from './client';
import type { Role, RoleView } from './types';
export type CreateRoleInput = { name: string; description?: string | null };
export const roles = {
  list: () => get('/api/roles') as Promise<{ roles: Role[] }>,
  get: (id: string) => get(`/api/roles/${id}`) as Promise<RoleView>,
  create: (input: CreateRoleInput) => post('/api/roles', input) as Promise<RoleView>,
  update: (id: string, patchBody: { name?: string; description?: string | null }) => patch(`/api/roles/${id}`, patchBody) as Promise<RoleView>,
  remove: (id: string) => del(`/api/roles/${id}`) as Promise<undefined>, // server returns 204
};
