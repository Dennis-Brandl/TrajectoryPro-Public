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

import { Position } from '@xyflow/react'
import type { Notation } from '@/types/notation'

/**
 * Per-notation visual configuration for node rendering.
 *
 * Each notation (flowchart, BPMN, ISA88) has different:
 * - Handle positions (TB vs LR flow direction)
 * - SVG dimensions for rect and gateway nodes
 * - Corner radius, label font size, icon positions
 * - ISA88-specific chevron rendering
 */
export interface NotationConfig {
  notation: Notation

  // Flow direction and handle positions
  inputPosition: Position
  outputPosition: Position

  // Rect node dimensions (ActionProxyWait, ScriptStep, WorkflowProxy, UserInteractionStep, YesNoStep)
  rect: {
    width: number
    height: number
    rx: number
    labelSize: string
    labelPx: string
    statusDot: { cx: number; cy: number; r: number }
    iconPos: { top: number; left: number }
    iconSize: number
  }

  // Gateway node dimensions (Select1, WaitAny, Parallel, WaitAll)
  gateway: {
    width: number
    height: number
  }

  // Start/End node styling
  startEnd: {
    labelSize: string
  }

  // ISA88-specific
  hasChevrons: boolean
}

export const NOTATION_CONFIGS: Record<Notation, NotationConfig> = {
  flowchart: {
    notation: 'flowchart',
    inputPosition: Position.Top,
    outputPosition: Position.Bottom,
    rect: {
      width: 120,
      height: 50,
      rx: 4,
      labelSize: 'text-[11px]',
      labelPx: 'px-2',
      statusDot: { cx: 112, cy: 8, r: 3 },
      iconPos: { top: 4, left: 4 },
      iconSize: 14,
    },
    gateway: { width: 60, height: 60 },
    startEnd: { labelSize: 'text-[9px]' },
    hasChevrons: false,
  },
  bpmn: {
    notation: 'bpmn',
    inputPosition: Position.Left,
    outputPosition: Position.Right,
    rect: {
      width: 140,
      height: 60,
      rx: 10,
      labelSize: 'text-[12px]',
      labelPx: 'px-3',
      statusDot: { cx: 130, cy: 10, r: 3.5 },
      iconPos: { top: 6, left: 6 },
      iconSize: 14,
    },
    gateway: { width: 40, height: 50 },
    startEnd: { labelSize: 'text-[8px]' },
    hasChevrons: false,
  },
  isa88: {
    notation: 'isa88',
    inputPosition: Position.Top,
    outputPosition: Position.Bottom,
    rect: {
      width: 130,
      height: 50,
      rx: 0,
      labelSize: 'text-[11px]',
      labelPx: 'px-3',
      statusDot: { cx: 121, cy: 8, r: 3 },
      iconPos: { top: 4, left: 22 },
      iconSize: 14,
    },
    gateway: { width: 90, height: 40 },
    startEnd: { labelSize: 'text-[9px]' },
    hasChevrons: true,
  },
}
