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

/** Spec 2026-10-13 §5.1/§6.4: what Force complete can act on — a waiting GATE, or a waiting
 *  repeating SCRIPT. The engine refuses anything else; this only decides where the button shows. */
export function isForceCompletable(stepType: string, state: string): boolean {
  return (stepType === 'GATE' && state === 'WAITING_GATE') || (stepType === 'SCRIPT' && state === 'WAITING_SCRIPT');
}
