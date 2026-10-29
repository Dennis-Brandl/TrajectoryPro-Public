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
import { get, del } from './client';
import type { EnvironmentSpec, EnvSpecView, EnvironmentResourcesView, EnvironmentValuePropertiesView } from './types';

// M6 reduced this to read + delete, mirroring workflows.ts. Loading moved to load.ts.
export const environments = {
  // Same endpoint as pickers.environments(); named here so the Environment hierarchy owns
  // its list (mirrors users.ts). One route serves the tree and the link-picker modal.
  list: () => get('/api/environments') as Promise<{ environments: EnvironmentSpec[] }>,
  get: (id: string) => get(`/api/environments/${id}`) as Promise<EnvSpecView>,
  remove: (id: string) => del(`/api/environments/${id}`) as Promise<undefined>, // server returns 204
  // Phase 3 (spec §6.2-6.3): the two live tabs' feeds; polled at 2 s while a tab is mounted.
  resources: (id: string) => get(`/api/environments/${id}/resources`) as Promise<EnvironmentResourcesView>,
  valueProperties: (id: string) => get(`/api/environments/${id}/value-properties`) as Promise<EnvironmentValuePropertiesView>,
};
