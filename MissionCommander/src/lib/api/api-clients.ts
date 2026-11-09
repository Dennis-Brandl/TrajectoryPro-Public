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
import { get, post } from './client';

// Spec 2026-11-08 §8.1. Administrator only. The token comes back once, from create.
export const API_CLIENT_SCOPES = ['schedules:read', 'schedules:write', 'schedules:control'] as const;
export type ApiClientScope = (typeof API_CLIENT_SCOPES)[number];

export type ApiClientView = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: ApiClientScope[];
  workCenterIds: string[];
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'revoked' | 'expired';
};

export type CreateApiClientInput = {
  name: string;
  scopes: ApiClientScope[];
  workCenterIds: string[];
  expiresAt?: string;
};

export const apiClients = {
  list: () => get('/api/api-clients') as Promise<ApiClientView[]>,
  create: (input: CreateApiClientInput) =>
    post('/api/api-clients', input) as Promise<{ client: ApiClientView; token: string }>,
  revoke: (id: string) => post(`/api/api-clients/${id}/revoke`) as Promise<undefined>,
};
