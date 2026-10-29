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
import type { StepKind } from '@mission/form-schema'

/** The form's step kind from its flow node type: Yes/No steps get Yes/No job buttons by default,
 *  every other form step gets a Continue button. */
export function stepKindOfNode(nodeType: string | undefined): StepKind {
  return nodeType === 'yesNoStep' ? 'yesno' : 'continue'
}
