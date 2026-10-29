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

// Phase 35 §2.4: batch-save request schema. `zod.strict()` everywhere —
// any unknown field anywhere in the payload → 422 'unknown_field'.

import { z } from 'zod'

const SpecStateEnum = z.enum(['Draft', 'InTest', 'InReview', 'Approved', 'Effective', 'Superseded', 'Obsolete'])

// ISA 88 type name: trimmed, blank -> null, max 50 after trimming.
const TypeNameField = z
  .string()
  .trim()
  .max(50)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()

const SpecCreate = z.strictObject({
  op: z.literal('create'),
  id: z.string().min(1),
  parentSpecificationId: z.string().nullable().optional(),
  rootSpecificationId: z.string().min(1),
  libraryId: z.string().nullable().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  typeName: TypeNameField,
  data: z.string(),
  dataSchemaVersion: z.number().int(),
  version: z.string().optional(),
  state: SpecStateEnum.optional(),
})

const SpecUpdate = z.strictObject({
  op: z.literal('update'),
  id: z.string().min(1),
  parentSpecificationId: z.string().nullable().optional(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  typeName: TypeNameField,
  data: z.string().optional(),
  dataSchemaVersion: z.number().int().optional(),
  // Phase 3: `version` and `state` are ACCEPTED but IGNORED on update — the
  // client echoes them on every dirty spec (buildBatchSavePayload); real
  // changes go through POST /:id/new-version and PATCH /:id/state. Dropping
  // them from the wire shape is Phase 5 (client migration).
  version: z.string().optional(),
  state: SpecStateEnum.optional(),
})

const SpecDelete = z.strictObject({
  op: z.literal('delete'),
  id: z.string().min(1),
})

const ProxyRefCreate = z.strictObject({
  op: z.literal('create'),
  parentSpecificationId: z.string().min(1),
  nodeId: z.string().min(1),
  targetSpecificationId: z.string().min(1),
})

const ProxyRefDelete = z.strictObject({
  op: z.literal('delete'),
  parentSpecificationId: z.string().min(1),
  nodeId: z.string().min(1),
})

const SpecEnvCreate = z.strictObject({
  op: z.literal('create'),
  specificationId: z.string().min(1),
  environmentLibraryId: z.string().min(1),
})

const SpecEnvDelete = z.strictObject({
  op: z.literal('delete'),
  specificationId: z.string().min(1),
  environmentLibraryId: z.string().min(1),
})

const ImageDeleteEntry = z.strictObject({
  specificationId: z.string().min(1),
  filename: z.string().min(1),
})

const ImageRefCreate = z.strictObject({
  op: z.literal('create'),
  specificationId: z.string().min(1),
  imageId: z.string().min(1),
})

const ImageRefDelete = z.strictObject({
  op: z.literal('delete'),
  specificationId: z.string().min(1),
  imageId: z.string().min(1),
})

export const BatchSaveRequest = z.strictObject({
  specs: z.array(z.discriminatedUnion('op', [SpecCreate, SpecUpdate, SpecDelete])),
  proxyRefs: z.array(z.discriminatedUnion('op', [ProxyRefCreate, ProxyRefDelete])),
  specEnvs: z.array(z.discriminatedUnion('op', [SpecEnvCreate, SpecEnvDelete])),
  imageDeletes: z.array(ImageDeleteEntry),
  imageRefs: z.array(z.discriminatedUnion('op', [ImageRefCreate, ImageRefDelete])),
})

export type BatchSaveRequest = z.infer<typeof BatchSaveRequest>
export type SpecCreate = z.infer<typeof SpecCreate>
export type SpecUpdate = z.infer<typeof SpecUpdate>
export type SpecDelete = z.infer<typeof SpecDelete>
