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
import type { StepNodeData } from '@/types/nodes'

/** P4.1 (spec §2): a step is "designed" iff the v2 document has any block. formLayouts is
 *  no longer consulted — migration, import-minting, and the v1-save sync-write guarantee
 *  every designed step carries formDocument. */
export function isFormDesigned(data: Pick<StepNodeData, 'formDocument'>): boolean {
  return !!data.formDocument?.sections.some((s) => s.rows.some((r) => r.blocks.length > 0))
}
