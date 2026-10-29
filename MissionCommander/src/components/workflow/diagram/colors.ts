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

/**
 * Step colors, transcribed from Mission Designer's
 * src/components/nodes/renderers/shared/colors.ts.
 *
 * Only the STROKE values are used verbatim in both themes — they are mid-tone and read on a
 * light or a dark surface. Designer's pastel fills (#dcfce7, #fef3c7, #f3e8ff) would glare on
 * a dark background, so the renderer uses them in light mode and falls back to the stroke
 * color at low opacity in dark mode rather than maintaining a second palette.
 */
export const DEFAULT_STROKE = '#64748b';
export const START_COLOR = '#22c55e';
export const START_FILL = '#dcfce7';
export const END_COLOR = '#ef4444';
export const END_FILL = '#fee2e2';
export const GATEWAY_AMBER = '#f59e0b';
export const GATEWAY_FILL = '#fef3c7';
export const PARALLEL_PURPLE = '#a855f7';
export const PARALLEL_FILL = '#f3e8ff';
export const SCRIPT_AMBER = '#d97706';

export type StepPalette = { stroke: string; fill: string };

export function paletteFor(stepType: string): StepPalette {
  switch (stepType) {
    case 'START': return { stroke: START_COLOR, fill: START_FILL };
    case 'END': return { stroke: END_COLOR, fill: END_FILL };
    case 'PARALLEL':
    case 'WAIT ALL': return { stroke: PARALLEL_PURPLE, fill: PARALLEL_FILL };
    case 'SELECT 1':
    case 'WAIT ANY': return { stroke: GATEWAY_AMBER, fill: GATEWAY_FILL };
    case 'GATE': return { stroke: GATEWAY_AMBER, fill: GATEWAY_FILL };
    // Designer's ScriptStepNode.tsx always fills white (SCRIPT_AMBER is only the '<>' icon
    // color, never the shape fill) — confirmed against pdf-canvas-minimap.ts::getNodeStyle,
    // which returns { fill: '#ffffff', stroke: SCRIPT_AMBER } for 'scriptStep'.
    case 'SCRIPT': return { stroke: SCRIPT_AMBER, fill: '#ffffff' };
    default: return { stroke: DEFAULT_STROKE, fill: '#ffffff' };
  }
}
