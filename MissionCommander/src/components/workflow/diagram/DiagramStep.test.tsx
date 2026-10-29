// @vitest-environment jsdom
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

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { DiagramStep } from './DiagramStep';
import { placeSteps } from './layout';
import type { DiagramSpec, DiagramStep as Step, Notation } from '@/lib/api/types';

afterEach(cleanup);

function renderGate(step: Partial<Step>, notation: Notation) {
  const spec: DiagramSpec = {
    oid: 'w', name: 'W', version: '1', state: null, notation,
    steps: [{ oid: 'g', name: 'Gate', stepType: 'GATE', x: 0, y: 0, childSpecOid: null, ...step }],
    connections: [], children: [],
  };
  const [placed] = placeSteps(spec);
  render(<svg><DiagramStep placed={placed} notation={notation} /></svg>);
}

describe('DiagramStep timed GATE clock mark', () => {
  for (const notation of ['flowchart', 'bpmn', 'isa88'] as const) {
    it(`${notation}: a timed gate draws the clock in both the light and dark copies`, () => {
      renderGate({ timedGate: true }, notation);
      expect(screen.getAllByTestId('gate-clock')).toHaveLength(2);
    });
    it(`${notation}: a plain gate has no clock`, () => {
      renderGate({}, notation);
      expect(screen.queryAllByTestId('gate-clock')).toHaveLength(0);
    });
  }
});
