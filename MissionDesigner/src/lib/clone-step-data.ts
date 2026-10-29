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

import type { StepNodeData, ParameterSpec, ValueSpec, StepResourceCommand, Select1OptionSpec } from '@/types/nodes'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import { cloneFormDocument } from '@/lib/form-document/clone-document'

/**
 * Deep-clone StepNodeData, regenerating all step-internal IDs so the copy
 * is fully independent from the original. Used for "include by copy" from
 * the step library and for copy/paste.
 *
 * Regenerates IDs for: inputs, outputs, values (and their entries),
 * resourceCommands, uiParameters, select1Options, formDocument blocks,
 * and ISA88 dynamic handles.
 *
 * Preserves by-name references: resourceName, resourceSourceType/Oid,
 * target/source on resource commands, outputParameter, defaultSource,
 * environmentSpecId, actionName/actionLibraryName.
 */
export function cloneStepData(data: StepNodeData): StepNodeData {
  const cloned: StepNodeData = { ...data }

  // Inputs — regenerate param IDs and any nested entry IDs
  if (cloned.inputs) {
    cloned.inputs = cloned.inputs.map((p: ParameterSpec) => ({
      ...p,
      id: generateOID(WORKER_INTERNAL),
      entries: p.entries?.map((e) => ({ ...e, id: generateOID(WORKER_INTERNAL) })),
    }))
  }

  // Outputs — same structure as inputs
  if (cloned.outputs) {
    cloned.outputs = cloned.outputs.map((p: ParameterSpec) => ({
      ...p,
      id: generateOID(WORKER_INTERNAL),
      entries: p.entries?.map((e) => ({ ...e, id: generateOID(WORKER_INTERNAL) })),
    }))
  }

  // Value properties — regenerate property IDs and entry IDs
  if (cloned.values) {
    cloned.values = cloned.values.map((v: ValueSpec) => ({
      ...v,
      id: generateOID(WORKER_INTERNAL),
      entries: v.entries.map((e) => ({ ...e, id: generateOID(WORKER_INTERNAL) })),
    }))
  }

  // Resource commands — regenerate command IDs, preserve name-based references
  if (cloned.resourceCommands) {
    cloned.resourceCommands = cloned.resourceCommands.map((rc: StepResourceCommand) => ({
      ...rc,
      id: generateOID(WORKER_INTERNAL),
    }))
  }

  // UI parameters
  if (cloned.uiParameters) {
    cloned.uiParameters = cloned.uiParameters.map((p) => ({
      ...p,
      id: generateOID(WORKER_INTERNAL),
    }))
  }

  // Select1 options — IDs serve as handle IDs and connection_ids
  if (cloned.select1Options) {
    cloned.select1Options = cloned.select1Options.map((o: Select1OptionSpec) => ({
      ...o,
      id: generateOID(WORKER_INTERNAL),
    }))
  }

  // v2 form document — deep clone with fresh section/row/block ids and imageOids
  if (cloned.formDocument) {
    cloned.formDocument = cloneFormDocument(cloned.formDocument)
  }

  // ISA88 dynamic handles
  if (cloned.isa88TargetHandles) {
    cloned.isa88TargetHandles = cloned.isa88TargetHandles.map(() => generateOID(WORKER_INTERNAL))
  }
  if (cloned.isa88SourceHandles) {
    cloned.isa88SourceHandles = cloned.isa88SourceHandles.map(() => generateOID(WORKER_INTERNAL))
  }

  return cloned
}
