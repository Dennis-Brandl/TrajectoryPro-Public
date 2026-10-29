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
import { parseBatchmlXml } from './xml-serializer'
import { fromBase64Utf8 } from './base64'
import { CANONICAL_PAYLOAD_ID, ACCEPTED_PAYLOAD_PREFIXES } from './canonical-payload'

export class BatchmlImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BatchmlImportError'
  }
}

interface OtherInfoLike {
  ID?: string
  Value?: Array<{ ValueString?: string }> | { ValueString?: string }
}

/** fast-xml-parser yields a single object for a lone element, an array for many. */
function asArray<T>(x: T | T[] | undefined): T[] {
  if (x === undefined) return []
  return Array.isArray(x) ? x : [x]
}

/**
 * Read a Designer-authored BatchML file back into the exact canonical workflow
 * spec. Only files carrying the Trajectory OtherInformation payload are
 * supported (round-trip only); foreign recipes throw BatchmlImportError.
 */
export function importBatchml(xmlText: string): MasterWorkflowSpecification {
  let parsed: Record<string, unknown>
  try {
    parsed = parseBatchmlXml(xmlText)
  } catch {
    throw new BatchmlImportError('The file is not valid XML.')
  }

  const mr = parsed.MasterRecipe as Record<string, unknown> | undefined
  if (!mr) {
    throw new BatchmlImportError('Not a BatchML MasterRecipe document.')
  }

  const others = asArray(mr.OtherInformation as OtherInfoLike | OtherInfoLike[] | undefined)
  const payload = others.find((o) => {
    const id = o.ID
    return typeof id === 'string' && ACCEPTED_PAYLOAD_PREFIXES.some((prefix) => id.startsWith(prefix))
  })
  if (!payload) {
    throw new BatchmlImportError(
      'This BatchML file was not produced by Mission Designer. Importing foreign recipes is not supported.',
    )
  }

  const valueString = asArray(asArray(payload.Value)[0]?.ValueString)[0]
  if (!valueString) {
    const foundId = payload.ID ?? CANONICAL_PAYLOAD_ID
    throw new BatchmlImportError(`Corrupt ${foundId} payload: no value.`)
  }

  try {
    return JSON.parse(fromBase64Utf8(valueString)) as MasterWorkflowSpecification
  } catch {
    throw new BatchmlImportError('Corrupt Mission Designer payload: could not decode the embedded specification.')
  }
}
