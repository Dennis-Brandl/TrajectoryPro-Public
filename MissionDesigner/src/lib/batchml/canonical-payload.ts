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

import type { B2mmlMasterRecipe } from './batchml-types'
import type { MasterWorkflowSpecification } from '@/lib/packageFormat/export-types'
import { toBase64Utf8 } from './base64'

export const CANONICAL_PAYLOAD_PREFIX = 'MissionDesigner:CanonicalSpec/'
export const CANONICAL_PAYLOAD_ID = `${CANONICAL_PAYLOAD_PREFIX}1.0`

/**
 * Every payload prefix the importer accepts. 'TrajectoryProStudio:CanonicalSpec/' is what every
 * file exported before 2026-09-11 (rebrand wave 2b) carries; it is accepted PERMANENTLY, never
 * deprecated — it is the only thing that can read the files already in the wild.
 */
export const ACCEPTED_PAYLOAD_PREFIXES = [CANONICAL_PAYLOAD_PREFIX, 'TrajectoryProStudio:CanonicalSpec/'] as const
const PRODUCER_ID = 'MissionDesigner:Producer'

/**
 * BatchML export embeds the exact canonical spec, base64-encoded, in a
 * schema-valid OtherInformation element so re-import is lossless. That is the
 * whole point of the export: the B2MML PFC skeleton is a standards-shaped
 * projection, while this payload carries the entire truth (TRY/CATCH/RETURN,
 * scripts, forms, resources, nested children — none of which BatchML can hold).
 */
export function attachCanonicalPayload(
  recipe: B2mmlMasterRecipe,
  spec: MasterWorkflowSpecification,
): B2mmlMasterRecipe {
  const payload = toBase64Utf8(JSON.stringify(spec))
  const others = recipe.otherInformation ?? []
  others.push({
    id: CANONICAL_PAYLOAD_ID,
    value: [{ valueString: payload, dataType: 'base64Binary', unitOfMeasure: 'none', dataInterpretation: 'Other' }],
    description: [
      'Exact Mission Designer canonical workflow specification (base64 JSON). Ignore if not a Mission Designer consumer.',
    ],
  })
  others.push({
    id: PRODUCER_ID,
    description: [`Mission Designer; canonical schemaVersion ${spec.schemaVersion ?? '4.0'}`],
  })
  return { ...recipe, otherInformation: others }
}
