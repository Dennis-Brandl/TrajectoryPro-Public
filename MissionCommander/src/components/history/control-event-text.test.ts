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
import { describe, it, expect } from 'vitest';
import { controlEventText, controlEventRecordText } from './control-event-text';

describe('control event text', () => {
  it('plain stop and abort keep their wording', () => {
    expect(controlEventText({ verb: 'stop', effect: 'request', stepName: null })).toBe('Stop requested');
    expect(controlEventRecordText({ verb: 'abort', effect: 'escalate', stepName: null })).toBe('Abort requested (escalated)');
  });
  it('a Stop from Pilot names the step', () => {
    expect(controlEventText({ verb: 'stop', effect: 'request', stepName: 'Check Oven' })).toBe('Stop requested from Pilot on «Check Oven»');
    expect(controlEventRecordText({ verb: 'stop', effect: 'request', stepName: 'Check Oven' })).toBe('Stop requested from Pilot on «Check Oven»');
  });
});
