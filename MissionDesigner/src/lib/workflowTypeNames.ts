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

import { TYPE_NAME_MAX } from '@/lib/packageFormat/type-name'

/** ISA 88 workflow types offered as suggestions (any text is still accepted). */
export const WORKFLOW_TYPE_NAMES: readonly string[] = [
  'Procedure',
  'Unit Procedure',
  'Operation',
  'Phase',
  'Macro Phase',
  'Recipe Segment',
  'Unit Recipe',
  'Macro Operation',
  'Subphase',
  'Suboperation',
]

export const MAX_TYPE_NAME_LENGTH = TYPE_NAME_MAX

export const TYPE_NAME_TOO_LONG_MESSAGE = `Type must be ${MAX_TYPE_NAME_LENGTH} characters or fewer.`
