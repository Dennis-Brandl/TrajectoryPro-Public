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
//
// Child-process body for script-rejection-guard.test.ts: installs the engine's guard (unless
// mode is 'none'), runs a SCRIPT that leaves two rejected promises, optionally rejects an
// engine-side promise, and prints 'still alive' if the process survives.
import { executeScript, installScriptRejectionGuard } from '../../src/core/step-handlers.js';
import { PropertyStore } from '../../src/core/properties.js';
import type { MasterWorkflowStep } from '../../src/spec/types.js';

const mode = process.argv[2];
if (mode !== 'none') installScriptRejectionGuard();
const step = {
  step_type: 'SCRIPT',
  script_config: { source: '(async () => { throw new Error("x"); })(); Promise.reject(1); output.ok = "yes";' },
} as unknown as MasterWorkflowStep;
console.log(JSON.stringify(executeScript(step, new PropertyStore(), {}, 1000)));
if (mode === 'host') void Promise.reject(new Error('engine bug'));
setTimeout(() => console.log('still alive'), 200);
