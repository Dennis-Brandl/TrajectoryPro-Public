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
import type { MePrincipal, WcNode } from '@/lib/api/types';

export type WcMode = 'full' | 'view-only';
type Rights = Pick<MePrincipal, 'isAdministrator' | 'missionSystemCommanderOf'>;

export function canUseXo(me: Pick<MePrincipal, 'accessLevel'>): boolean {
  return me.accessLevel === 'steward' || me.accessLevel === 'administrator';
}

export function workCenterMode(me: Rights, workCenterId: string): WcMode {
  return me.isAdministrator || me.missionSystemCommanderOf.includes(workCenterId) ? 'full' : 'view-only';
}

export function orderWorkCenters(nodes: WcNode[], me: Rights): Array<WcNode & { mode: WcMode }> {
  const all = nodes.map((node) => ({ ...node, mode: workCenterMode(me, node.id) }));
  return [...all.filter((x) => x.mode === 'full'), ...all.filter((x) => x.mode === 'view-only')];
}
