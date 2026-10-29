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
import type { DiagramSpec, DiagramStep } from '@/lib/api/types';
import { NOTATION_CONFIGS, shapeFor, type Shape } from './notation';

export type PlacedStep = {
  step: DiagramStep;
  x: number; y: number; width: number; height: number;
  shape: Shape;
};
export type PlacedEdge = {
  key: string; d: string;
  labelX: number; labelY: number;
  condition: string | null;
};
export type Bounds = { minX: number; minY: number; width: number; height: number };

/** Padding around the content when fitting, in spec units. */
export const FIT_PADDING = 40;

export function placeSteps(spec: DiagramSpec): PlacedStep[] {
  const config = NOTATION_CONFIGS[spec.notation];
  return spec.steps.map((step) => {
    const shape = shapeFor(step.stepType);
    const size =
      shape === 'endpoint' || shape === 'trapezoid'
        ? { width: config.endpoint.size, height: config.endpoint.size }
        : shape === 'gateway' || shape === 'gate'
          ? { width: config.gateway.width, height: config.gateway.height }
          : { width: config.rect.width, height: config.rect.height };
    return { step, x: step.x, y: step.y, ...size, shape };
  });
}

// Where an edge attaches: the bottom/top edges when the notation flows top-to-bottom
// (flowchart, ISA-88), the right/left edges when it flows left-to-right (BPMN). This
// mirrors Designer's inputPosition/outputPosition, which are the same two pairs.
function outAnchor(p: PlacedStep, flow: 'vertical' | 'horizontal') {
  return flow === 'vertical'
    ? { x: p.x + p.width / 2, y: p.y + p.height }
    : { x: p.x + p.width, y: p.y + p.height / 2 };
}
function inAnchor(p: PlacedStep, flow: 'vertical' | 'horizontal') {
  return flow === 'vertical'
    ? { x: p.x + p.width / 2, y: p.y }
    : { x: p.x, y: p.y + p.height / 2 };
}

// ── Orthogonal edge routing, transcribed from Designer's ConditionalEdge.tsx
// (calculatePathPoints) so the diagram matches what the author laid out there.
// Forward flow: a 4-point path whose crossover segment sits at the source/target
// midline. Backward flow (a loop): a 6-point path that turns TURN units out of the
// source, runs along a bypass lane clear of both nodes, and re-enters the target
// from its inbound side. `waypoints[0]` is a DELTA the author dragged onto the
// crossover/bypass position (JSON_SCHEMA §1.6) — never an absolute canvas point —
// and longer arrays are reserved, so only index 0 is read.
type Point = { x: number; y: number };
const NEAR_OFFSET = 5;         // Designer: base offset from node for near-aligned nodes
const TURN = 20;               // Designer: 2 grid marks out of the node before turning
const NODE_CLEARANCE_V = 30;   // Designer: vertical bypass-lane clearance
const NODE_CLEARANCE_H = 50;   // Designer: horizontal bypass-lane clearance

function routePoints(start: Point, end: Point, flow: 'vertical' | 'horizontal', wp: Point): Point[] {
  const points: Point[] = [start];
  if (flow === 'vertical') {
    if (end.y < start.y) {
      // Backward loop — down first, bypass to the right of both nodes, back up.
      const routeX = Math.max(start.x, end.x) + NODE_CLEARANCE_H + wp.x;
      points.push({ x: start.x, y: start.y + TURN });
      points.push({ x: routeX, y: start.y + TURN });
      points.push({ x: routeX, y: end.y - TURN });
      points.push({ x: end.x, y: end.y - TURN });
    } else if (Math.abs(end.y - start.y) > 5 && Math.abs(end.x - start.x) > 5) {
      const midY = (start.y + end.y) / 2 + wp.y;
      points.push({ x: start.x, y: midY });
      points.push({ x: end.x, y: midY });
    } else {
      const nearY = start.y + NEAR_OFFSET;
      points.push({ x: start.x, y: nearY });
      points.push({ x: end.x, y: nearY });
    }
  } else {
    if (end.x < start.x) {
      // Backward loop — right first, bypass below both nodes, back left.
      const routeY = Math.max(start.y, end.y) + NODE_CLEARANCE_V + wp.y;
      points.push({ x: start.x + TURN, y: start.y });
      points.push({ x: start.x + TURN, y: routeY });
      points.push({ x: end.x - TURN, y: routeY });
      points.push({ x: end.x - TURN, y: end.y });
    } else if (Math.abs(end.x - start.x) > 5 && Math.abs(end.y - start.y) > 5) {
      const midX = (start.x + end.x) / 2 + wp.x;
      points.push({ x: midX, y: start.y });
      points.push({ x: midX, y: end.y });
    } else {
      const nearX = start.x + NEAR_OFFSET;
      points.push({ x: nearX, y: start.y });
      points.push({ x: nearX, y: end.y });
    }
  }
  points.push(end);
  return points;
}

/** Spec §4.5: the condition label sits at the connection's midpoint — concretely, the
 *  midpoint of the MIDDLE segment (the forward crossover, or the backward bypass lane),
 *  which is always on the drawn line. Near-aligned paths degenerate that segment to
 *  (almost) nothing, so they fall back to the plain start/end midpoint instead of
 *  parking the label right at the source's outbound anchor. */
function labelPoint(points: Point[], start: Point, end: Point): Point {
  const i = Math.floor((points.length - 1) / 2);
  const a = points[i], b = points[i + 1];
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > NEAR_OFFSET
    ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

export function placeEdges(spec: DiagramSpec, placed: PlacedStep[]): PlacedEdge[] {
  const { flow } = NOTATION_CONFIGS[spec.notation];
  const byOid = new Map(placed.map((p) => [p.step.oid, p]));
  const edges: PlacedEdge[] = [];

  spec.connections.forEach((conn, index) => {
    const from = byOid.get(conn.fromStepOid);
    const to = byOid.get(conn.toStepOid);
    // An endpoint that names no step in this spec is not drawable. The server validated
    // the SHAPE of spec_jsonb, not its referential integrity, so this can happen.
    if (!from || !to) return;

    const start = outAnchor(from, flow);
    const end = inAnchor(to, flow);
    const wp = { x: conn.waypoints?.[0]?.x ?? 0, y: conn.waypoints?.[0]?.y ?? 0 };
    const points = routePoints(start, end, flow, wp);
    const d = points
      .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
      .join(' ');
    const mid = labelPoint(points, start, end);

    // The index is part of the key because two connections may legitimately share both
    // endpoints (e.g. distinct conditions), and React keys must be unique.
    edges.push({
      key: `${conn.fromStepOid}->${conn.toStepOid}#${index}`,
      d, labelX: mid.x, labelY: mid.y, condition: conn.condition,
    });
  });

  return edges;
}

export function contentBounds(placed: PlacedStep[]): Bounds {
  // A degenerate viewBox ("0 0 0 0") renders nothing at all, so an empty spec still gets a
  // real box — the empty-state message renders over it.
  if (!placed.length) return { minX: 0, minY: 0, width: 200, height: 100 };
  const minX = Math.min(...placed.map((p) => p.x));
  const minY = Math.min(...placed.map((p) => p.y));
  const maxX = Math.max(...placed.map((p) => p.x + p.width));
  const maxY = Math.max(...placed.map((p) => p.y + p.height));
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}
