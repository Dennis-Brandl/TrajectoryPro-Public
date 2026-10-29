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

import type { MasterWorkflowSpecification } from '@/lib/packageFormat/export-types'
import { buildMasterRecipe } from './pfc-builder'
import { serializeMasterRecipe } from './xml-serializer'
import { attachCanonicalPayload, CANONICAL_PAYLOAD_ID } from './canonical-payload'

export { CANONICAL_PAYLOAD_ID }

/**
 * Export a workflow to a B2MML V0700 MasterRecipe XML document. The document
 * embeds the exact canonical spec as a base64 OtherInformation payload, so a
 * Designer → BatchML → Designer round-trip is lossless.
 */
export function exportBatchml(spec: MasterWorkflowSpecification): string {
  const recipe = buildMasterRecipe(spec)
  const withPayload = attachCanonicalPayload(recipe, spec)
  return serializeMasterRecipe(withPayload)
}
