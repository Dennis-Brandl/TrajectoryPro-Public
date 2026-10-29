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
import { get, put, del } from './client';
import type { ControlGrantList, ControlGrantScope } from './types';

export const controlGrants = {
  list: (workCenterId: string) =>
    get(`/api/work-centers/${workCenterId}/control-grants`) as Promise<ControlGrantList>,
  // Administrator-only server routes.
  set: (workCenterId: string, targetId: string, scope: ControlGrantScope) =>
    put(`/api/work-centers/${workCenterId}/control-grants/${targetId}`, { scope }) as Promise<undefined>,
  remove: (workCenterId: string, targetId: string) =>
    del(`/api/work-centers/${workCenterId}/control-grants/${targetId}`) as Promise<undefined>,
};
