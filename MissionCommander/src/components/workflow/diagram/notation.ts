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
import type { Notation } from '@/lib/api/types';

/**
 * Per-notation node geometry, transcribed from Mission Designer's
 * src/components/nodes/renderers/notation-config.ts.
 *
 * Designer's version types its handle positions against @xyflow/react's `Position` enum; this
 * app has no xyflow dependency, so that collapses to a `flow` direction — the only thing the
 * SVG renderer needs it for is which edge of a node an edge attaches to.
 */
export type NotationConfig = {
  // labelFontPx corresponds to Designer's rect.labelSize (e.g. 'text-[11px]' -> 11), NOT to
  // Designer's own rect.labelPx field — that field is a Tailwind padding class ('px-2'/'px-3'),
  // an unrelated value under the same name. Named differently here on purpose to avoid the
  // false cognate when this file is next diffed against Designer's notation-config.ts.
  rect: { width: number; height: number; rx: number; labelFontPx: number };
  gateway: { width: number; height: number };
  endpoint: { size: number };
  flow: 'vertical' | 'horizontal';
  hasChevrons: boolean;
};

export const NOTATION_CONFIGS: Record<Notation, NotationConfig> = {
  flowchart: {
    rect: { width: 120, height: 50, rx: 4, labelFontPx: 11 },
    gateway: { width: 60, height: 60 },
    endpoint: { size: 30 },
    flow: 'vertical',
    hasChevrons: false,
  },
  bpmn: {
    rect: { width: 140, height: 60, rx: 10, labelFontPx: 12 },
    gateway: { width: 40, height: 50 },
    endpoint: { size: 30 },
    flow: 'horizontal',
    hasChevrons: false,
  },
  isa88: {
    rect: { width: 130, height: 50, rx: 0, labelFontPx: 11 },
    // Designer lets an author resize ISA-88 control nodes and stores it as data.isa88Width,
    // which the WFmaster export format does NOT carry — so these always render at the
    // 90px default (useIsa88Resize.ts::DEFAULT_ISA88_WIDTH).
    gateway: { width: 90, height: 40 },
    endpoint: { size: 30 },
    flow: 'vertical',
    hasChevrons: true,
  },
};

export type Shape = 'rect' | 'gateway' | 'endpoint' | 'trapezoid' | 'gate';

const GATEWAY_TYPES = new Set(['SELECT 1', 'WAIT ANY', 'PARALLEL', 'WAIT ALL']);
const ENDPOINT_TYPES = new Set(['START', 'END']);
const TRAPEZOID_TYPES = new Set(['CATCH', 'RETURN']);
const GATE_TYPES = new Set(['GATE']);

/**
 * An unrecognised step_type deliberately falls through to 'rect' rather than being dropped:
 * a step type added to Designer later must still appear here, degraded, not vanish.
 */
export function shapeFor(stepType: string): Shape {
  if (ENDPOINT_TYPES.has(stepType)) return 'endpoint';
  if (GATEWAY_TYPES.has(stepType)) return 'gateway';
  if (TRAPEZOID_TYPES.has(stepType)) return 'trapezoid';
  if (GATE_TYPES.has(stepType)) return 'gate';
  return 'rect';
}
