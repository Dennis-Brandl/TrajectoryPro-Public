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

import { z } from 'zod'

export const saveWorkflowSchema = z.object({
  nodes: z.array(z.any()).max(10000),
  edges: z.array(z.any()).max(50000),
  workflowInputs: z.array(z.any()).max(1000).optional(),
  workflowOutputs: z.array(z.any()).max(1000).optional(),
  workflowValues: z.array(z.any()).max(1000).optional(),
  workflowResources: z.array(z.any()).max(1000).optional(),
  workflowTrySpecifications: z.array(z.any()).max(10).optional(),
  images: z.record(z.string(), z.string()).optional(),
})

export const createSpecificationSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(5000).optional(),
  data: z.any(),
  version: z.string().max(50).optional(),
  state: z.string().max(50).optional(),
  environmentLibraryIds: z.array(z.string()).max(100).optional(),
})
