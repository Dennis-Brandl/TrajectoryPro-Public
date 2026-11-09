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
import { describe, it, expect, beforeEach } from 'vitest';
import { useScheduleAttentionStore, scheduleAttentionCount } from './scheduleAttentionStore';

const row = (id: string, failed = 0, lost = 0, missedWindow = false) => ({ id, needsAttention: { failed, lost, missedWindow } });
const count = (wcId: string) => scheduleAttentionCount(useScheduleAttentionStore.getState(), wcId);
beforeEach(() => useScheduleAttentionStore.setState({ wcId: null, flagged: [] }));

describe('scheduleAttentionStore', () => {
  it('counts schedules with a failed start, a lost run or a missed decision', () => {
    useScheduleAttentionStore.getState().setAll('a', [row('1', 1), row('2'), row('3', 0, 2), row('4', 0, 0, true)]);
    expect(count('a')).toBe(3);
  });
  it('counts nothing for another work center', () => {
    useScheduleAttentionStore.getState().setAll('a', [row('1', 1)]);
    expect(count('b')).toBe(0);
  });
  it('setOne adds and clears one schedule', () => {
    const s = useScheduleAttentionStore.getState();
    s.setAll('a', [row('1', 1), row('2', 0, 1)]);
    s.setOne('a', row('1'));
    expect(count('a')).toBe(1);
    s.setOne('a', row('3', 1));
    expect(count('a')).toBe(2);
  });
});
