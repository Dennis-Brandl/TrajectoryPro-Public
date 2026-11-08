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
import type { RuntimeWorkflowLiveDetail, RuntimeWorkflowStatus } from '@/lib/api/types';
import { availableVerbs, CONFIRM_VERBS } from './controls';

const detail = (status: RuntimeWorkflowStatus, operatorCleanup = { stop: false, abort: false }) =>
  ({ summary: { status }, steps: [], trace: [], signatures: [], operatorCleanup }) as unknown as RuntimeWorkflowLiveDetail;

describe('availableVerbs', () => {
  it('running, full, online: pause/stop/abort only', () => {
    const v = availableVerbs(detail('running'), 'full', false);
    expect(v).toMatchObject({ pause: true, stop: true, abort: true, start: false, resume: false, delete: false, stopNow: false, abortNow: false });
  });
  it('view-only gives nothing', () => {
    expect(Object.values(availableVerbs(detail('running'), 'view-only', false)).some(Boolean)).toBe(false);
  });
  it('offline gives nothing', () => {
    expect(Object.values(availableVerbs(detail('running'), 'full', true)).some(Boolean)).toBe(false);
  });
  it('stopping with operatorCleanup.stop offers stopNow', () => {
    expect(availableVerbs(detail('stopping', { stop: true, abort: false }), 'full', false).stopNow).toBe(true);
    expect(availableVerbs(detail('stopping'), 'full', false).stopNow).toBe(false);
  });
  it('pending offers start and delete; completed offers delete', () => {
    expect(availableVerbs(detail('pending'), 'full', false)).toMatchObject({ start: true, delete: true });
    expect(availableVerbs(detail('completed'), 'full', false).delete).toBe(true);
  });
  it('confirms the destructive verbs', () => {
    expect([...CONFIRM_VERBS].sort()).toEqual(['abort', 'abortNow', 'delete', 'stop', 'stopNow']);
  });
});
