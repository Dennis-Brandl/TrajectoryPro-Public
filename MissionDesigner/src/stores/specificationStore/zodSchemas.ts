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

// Phase 35 §4 F10: strict zod validation on every server response before
// inserting into specs/libraries. Prevents a malicious or buggy server
// response from smuggling malformed rows into the canvas.

import { z } from 'zod'

// Note: zod v4 retains .passthrough() as a method on ZodObject schemas.
// Verified in this codebase: z.object({...}).passthrough() exists, enforces
// required fields on parse, and passes through unknown extra keys safely.

export const LibrarySchema = z
  .object({
    id: z.string(),
    parentLibraryId: z.string().nullable(),
    teamId: z.string().nullable().optional(),
    name: z.string(),
    entityType: z.string(),
    description: z.string().nullable(),
    author: z.string().nullable().optional(),
    changeHistory: z.string().nullable().optional(),
    version: z.string().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
    lastEditedByUserId: z.string().nullable(),
  })
  .passthrough() // server may add fields; we ignore extras safely

export const SpecificationSchema = z
  .object({
    id: z.string(),
    parentSpecificationId: z.string().nullable(),
    rootSpecificationId: z.string(),
    libraryId: z.string().nullable(), // null for children in Plan 4+
    name: z.string(),
    description: z.string().nullable(),
    typeName: z.string().nullish(),
    version: z.string().nullable(),
    state: z.string().nullable(),
    data: z.string(), // raw JSON string from DB; store parses
    dataSchemaVersion: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
    lastEditedByUserId: z.string().nullable(),
  })
  .passthrough()

export type LibraryDTO = z.infer<typeof LibrarySchema>
export type SpecificationDTO = z.infer<typeof SpecificationSchema>

/** Parse the `data` JSON string → object. Throws on malformed JSON. */
export function parseSpecData(dto: SpecificationDTO): Record<string, unknown> {
  const parsed = JSON.parse(dto.data)
  if (!parsed || typeof parsed !== 'object') return { nodes: [] }
  return parsed as Record<string, unknown>
}
