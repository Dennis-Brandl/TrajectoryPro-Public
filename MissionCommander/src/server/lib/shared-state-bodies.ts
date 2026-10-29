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
import { z } from 'zod';

// Phase 4b (spec §7.1): the engine's verb literals, mirrored here rather than imported from the
// engine (the CM never depends on the engine package) and kept OUT of engine-client.ts — route
// files iterate this at module load, and the route tests replace engine-client with a vi.mock
// factory. Task 3 adds the request-body schemas to this file.
export const RESOURCE_VERBS = ['release-holder', 'release', 'reset', 'cancel-waiter', 'clear-sync'] as const;
export type ResourceVerb = (typeof RESOURCE_VERBS)[number];

/** A value property is free text; this bound is a request-size guard, not a domain rule. */
export const MAX_VALUE_LENGTH = 4000;
const posInt = z.number().int().positive();
const name = z.string().min(1).max(200);

// The routes validate SHAPE only; verb-specific legality (a holderId on `reset`, an amount on a
// named pool) is the engine's, which answers VALIDATION 400 / NOT_SUPPORTED 409 with a message.
export const workCenterResourceVerbBody = z.object({
  name,
  holderId: posInt.optional(),
  waiterId: posInt.optional(),
  amount: posInt.optional(),
  poolName: name.optional(),
}).strict();

export const instanceResourceVerbBody = z.object({
  resourceKey: z.string().min(1).max(400),
  holderId: posInt.optional(),
  // D16: a number names an environment waiter row; a string names a workflow-tier step oid.
  waiterId: z.union([posInt, z.string().min(1).max(200)]).optional(),
  amount: posInt.optional(),
  poolName: name.optional(),
}).strict();

export const workCenterValueBody = z.object({
  propertyName: name, entryName: name, value: z.string().max(MAX_VALUE_LENGTH),
}).strict();

export const instanceValueBody = z.object({
  specOid: z.string().min(1).max(200).optional(), key: z.string().min(1).max(400), value: z.string().max(MAX_VALUE_LENGTH),
}).strict();
