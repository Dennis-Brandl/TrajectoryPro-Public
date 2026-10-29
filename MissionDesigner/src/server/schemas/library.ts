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

export const createLibrarySchema = z.object({
  name: z.string().min(1).max(100),
  entityType: z.enum(['workflow', 'step', 'environment', 'action']),
  parentLibraryId: z.string().optional(),
})

export const updateLibrarySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  changeHistory: z.string().optional(),
  environmentLibraryIds: z.array(z.string()).optional(),
})
