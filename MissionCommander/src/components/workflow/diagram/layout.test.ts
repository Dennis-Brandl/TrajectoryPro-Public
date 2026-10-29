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
import type { DiagramSpec } from '@/lib/api/types';
import { placeSteps, placeEdges, contentBounds } from './layout';

function spec(over: Partial<DiagramSpec> = {}): DiagramSpec {
  return {
    oid: 'r', name: 'R', version: null, state: null, notation: 'flowchart',
    steps: [], connections: [], children: [], ...over,
  };
}
const step = (oid: string, stepType: string, x: number, y: number) =>
  ({ oid, name: oid, stepType, x, y, childSpecOid: null });

describe('placeSteps', () => {
  it('sizes a rect step from the notation config', () => {
    const [p] = placeSteps(spec({ steps: [step('a', 'USER_INTERACTION', 10, 20)] }));
    expect(p).toMatchObject({ x: 10, y: 20, width: 120, height: 50, shape: 'rect' });
  });

  it('uses the bpmn rect size when the spec says bpmn', () => {
    const [p] = placeSteps(spec({ notation: 'bpmn', steps: [step('a', 'USER_INTERACTION', 0, 0)] }));
    expect(p).toMatchObject({ width: 140, height: 60 });
  });

  it('uses the isa88 rect and gateway sizes when the spec says isa88', () => {
    const placed = placeSteps(spec({ notation: 'isa88', steps: [
      step('a', 'USER_INTERACTION', 0, 0), step('g', 'SELECT 1', 0, 0),
    ] }));
    expect(placed[0]).toMatchObject({ width: 130, height: 50, shape: 'rect' });
    expect(placed[1]).toMatchObject({ width: 90, height: 40, shape: 'gateway' });
  });

  it('sizes endpoints, gateways and trapezoids by shape', () => {
    const placed = placeSteps(spec({ steps: [
      step('s', 'START', 0, 0), step('g', 'SELECT 1', 0, 0), step('c', 'CATCH', 0, 0),
    ] }));
    expect(placed[0]).toMatchObject({ shape: 'endpoint', width: 30, height: 30 });
    expect(placed[1]).toMatchObject({ shape: 'gateway', width: 60, height: 60 });
    expect(placed[2]).toMatchObject({ shape: 'trapezoid', width: 30, height: 30 });
  });

  it('sizes a GATE step like a gateway, per notation', () => {
    expect(placeSteps(spec({ steps: [step('gt', 'GATE', 0, 0)] }))[0])
      .toMatchObject({ shape: 'gate', width: 60, height: 60 });
    expect(placeSteps(spec({ notation: 'isa88', steps: [step('gt', 'GATE', 0, 0)] }))[0])
      .toMatchObject({ shape: 'gate', width: 90, height: 40 });
  });

  it('falls through to rect for an unknown step type', () => {
    const [p] = placeSteps(spec({ steps: [step('a', 'TELEPORT', 0, 0)] }));
    expect(p.shape).toBe('rect');
  });
});

describe('placeEdges', () => {
  it('leaves the bottom of the source and enters the top of the target when flow is vertical', () => {
    const s = spec({ steps: [step('a', 'USER_INTERACTION', 0, 0), step('b', 'USER_INTERACTION', 0, 200)],
      connections: [{ fromStepOid: 'a', toStepOid: 'b', condition: null, sourceHandleId: null, waypoints: null }] });
    const [e] = placeEdges(s, placeSteps(s));
    // source centre-x 60, bottom y 50 → target centre-x 60, top y 200
    expect(e.d.startsWith('M 60 50')).toBe(true);
    expect(e.d.endsWith('60 200')).toBe(true);
    // Spec §4.5: the label sits at the connection's MIDPOINT, i.e. halfway between the
    // start (60, 50) and end (60, 200) anchors — (60, 125) — not at the end anchor itself
    // (60, 200), which is what `points[Math.floor(points.length / 2)]` returns for a plain
    // 2-point [start, end] path (index 1 = end).
    expect(e.labelX).toBe(60);
    expect(e.labelY).toBe(125);
  });

  it('leaves the right of the source and enters the left of the target when flow is horizontal', () => {
    const s = spec({ notation: 'bpmn',
      steps: [step('a', 'USER_INTERACTION', 0, 0), step('b', 'USER_INTERACTION', 300, 0)],
      connections: [{ fromStepOid: 'a', toStepOid: 'b', condition: null, sourceHandleId: null, waypoints: null }] });
    const [e] = placeEdges(s, placeSteps(s));
    expect(e.d.startsWith('M 140 30')).toBe(true);
    expect(e.d.endsWith('300 30')).toBe(true);
    // Midpoint of (140, 30) and (300, 30) is (220, 30) — not the target's inbound anchor
    // (300, 30), which the old index-1-of-2 logic returned and which, for bpmn's
    // left-middle target anchor, would centre the label right on the node body.
    expect(e.labelX).toBe(220);
    expect(e.labelY).toBe(30);
  });

  // Designer-router parity (2026-08-10 user-testing ticket: edges were drawn as diagonal
  // straight lines). The routing below transcribes ConditionalEdge.calculatePathPoints:
  // forward flow gets a 4-point orthogonal path whose crossover sits at the midline,
  // backward flow a 6-point bypass around both nodes.
  it('routes an offset forward connection orthogonally through the midline crossover', () => {
    const s = spec({ steps: [step('a', 'USER_INTERACTION', 0, 0), step('b', 'USER_INTERACTION', 100, 200)],
      connections: [{ fromStepOid: 'a', toStepOid: 'b', condition: 'yes', sourceHandleId: null, waypoints: null }] });
    const [e] = placeEdges(s, placeSteps(s));
    // start (60, 50) → down to midY 125 → across to target column → down into (160, 200)
    expect(e.d).toBe('M 60 50 L 60 125 L 160 125 L 160 200');
    expect(e.condition).toBe('yes');
    // The label sits on the crossover segment's midpoint.
    expect(e.labelX).toBe(110);
    expect(e.labelY).toBe(125);
  });

  it('applies waypoints[0] as a DELTA on the crossover, and ignores the reserved rest (JSON_SCHEMA §1.6)', () => {
    const s = spec({ steps: [step('a', 'USER_INTERACTION', 0, 0), step('b', 'USER_INTERACTION', 100, 200)],
      connections: [{ fromStepOid: 'a', toStepOid: 'b', condition: null, sourceHandleId: null, waypoints: [{ x: 0, y: 35 }, { x: 999, y: 999 }] }] });
    const [e] = placeEdges(s, placeSteps(s));
    // midY = (50 + 200) / 2 + 35 = 160; waypoints[1] must leave no trace.
    expect(e.d).toBe('M 60 50 L 60 160 L 160 160 L 160 200');
    expect(e.labelY).toBe(160);
  });

  it('routes a backward (loop) connection around both nodes via the right-hand bypass lane', () => {
    const s = spec({ steps: [step('a', 'USER_INTERACTION', 0, 200), step('b', 'USER_INTERACTION', 0, 0)],
      connections: [{ fromStepOid: 'a', toStepOid: 'b', condition: null, sourceHandleId: null, waypoints: null }] });
    const [e] = placeEdges(s, placeSteps(s));
    // start (60, 250): down TURN(20) → right to routeX max(60,60)+50 → up past target
    // by TURN → left over the target → into (60, 0).
    expect(e.d).toBe('M 60 250 L 60 270 L 110 270 L 110 -20 L 60 -20 L 60 0');
    // Label on the bypass lane's midpoint.
    expect(e.labelX).toBe(110);
    expect(e.labelY).toBe(125);
  });

  it('routes horizontal (bpmn) forward connections through a vertical crossover, honoring the waypoint x delta', () => {
    const s = spec({ notation: 'bpmn',
      steps: [step('a', 'USER_INTERACTION', 0, 0), step('b', 'USER_INTERACTION', 300, 150)],
      connections: [{ fromStepOid: 'a', toStepOid: 'b', condition: null, sourceHandleId: null, waypoints: [{ x: 10, y: 0 }] }] });
    const [e] = placeEdges(s, placeSteps(s));
    // start (140, 30), end (300, 180): midX = (140 + 300) / 2 + 10 = 230.
    expect(e.d).toBe('M 140 30 L 230 30 L 230 180 L 300 180');
    expect(e.labelX).toBe(230);
    expect(e.labelY).toBe(105);
  });

  it('routes a horizontal backward connection below both nodes', () => {
    const s = spec({ notation: 'bpmn',
      steps: [step('a', 'USER_INTERACTION', 300, 0), step('b', 'USER_INTERACTION', 0, 0)],
      connections: [{ fromStepOid: 'a', toStepOid: 'b', condition: null, sourceHandleId: null, waypoints: null }] });
    const [e] = placeEdges(s, placeSteps(s));
    // start (440, 30): right TURN → down to routeY max(30,30)+30 → left past target −TURN
    // → up to target level → into (0, 30).
    expect(e.d).toBe('M 440 30 L 460 30 L 460 60 L -20 60 L -20 30 L 0 30');
    expect(e.labelX).toBe(220);
    expect(e.labelY).toBe(60);
  });

  it('drops a connection whose endpoint matches no step', () => {
    const s = spec({ steps: [step('a', 'USER_INTERACTION', 0, 0)],
      connections: [{ fromStepOid: 'a', toStepOid: 'ghost', condition: null, sourceHandleId: null, waypoints: null }] });
    expect(placeEdges(s, placeSteps(s))).toEqual([]);
  });

  it('gives every edge a distinct key even when two connections share endpoints', () => {
    const s = spec({ steps: [step('a', 'USER_INTERACTION', 0, 0), step('b', 'USER_INTERACTION', 0, 200)],
      connections: [
        { fromStepOid: 'a', toStepOid: 'b', condition: null, sourceHandleId: null, waypoints: null },
        { fromStepOid: 'a', toStepOid: 'b', condition: 'other', sourceHandleId: null, waypoints: null },
      ] });
    const edges = placeEdges(s, placeSteps(s));
    expect(new Set(edges.map((e) => e.key)).size).toBe(2);
  });
});

describe('contentBounds', () => {
  it('handles negative coordinates', () => {
    const s = spec({ steps: [step('a', 'USER_INTERACTION', -50, -140), step('b', 'USER_INTERACTION', 100, 40)] });
    expect(contentBounds(placeSteps(s))).toMatchObject({
      minX: -50, minY: -140, width: 270, height: 230,
    });
  });

  it('returns a non-zero box for an empty spec so a viewBox is never degenerate', () => {
    const b = contentBounds([]);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
  });
});
