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

import { describe, it, expect } from 'vitest'
import { getNodeDimensions } from '@/hooks/useAutoLayout'

describe('Auto-Layout Dimension Registry', () => {
  describe('Flowchart notation', () => {
    it('returns 120x50 for userInteractionStep', () => {
      const dimensions = getNodeDimensions('userInteractionStep', 'flowchart')
      expect(dimensions).toEqual({ width: 120, height: 50 })
    })

    it('returns 120x50 for yesNoStep', () => {
      const dimensions = getNodeDimensions('yesNoStep', 'flowchart')
      expect(dimensions).toEqual({ width: 120, height: 50 })
    })

    it('returns 120x50 for scriptStep', () => {
      const dimensions = getNodeDimensions('scriptStep', 'flowchart')
      expect(dimensions).toEqual({ width: 120, height: 50 })
    })

    it('returns correct dimensions for v1 step types (no regression)', () => {
      // Test start/end
      expect(getNodeDimensions('start', 'flowchart')).toEqual({ width: 30, height: 30 })
      expect(getNodeDimensions('end', 'flowchart')).toEqual({ width: 30, height: 30 })

      // Test selection/parallel
      expect(getNodeDimensions('select1', 'flowchart')).toEqual({ width: 60, height: 60 })
      expect(getNodeDimensions('waitAny', 'flowchart')).toEqual({ width: 60, height: 60 })
      expect(getNodeDimensions('parallel', 'flowchart')).toEqual({ width: 60, height: 60 })
      expect(getNodeDimensions('waitAll', 'flowchart')).toEqual({ width: 60, height: 60 })

      // Test action/workflow proxies
      expect(getNodeDimensions('actionProxyWait', 'flowchart')).toEqual({ width: 120, height: 50 })
      expect(getNodeDimensions('workflowProxy', 'flowchart')).toEqual({ width: 120, height: 50 })
    })
  })

  describe('BPMN notation', () => {
    it('returns 140x60 for userInteractionStep', () => {
      const dimensions = getNodeDimensions('userInteractionStep', 'bpmn')
      expect(dimensions).toEqual({ width: 140, height: 60 })
    })

    it('returns 140x60 for yesNoStep', () => {
      const dimensions = getNodeDimensions('yesNoStep', 'bpmn')
      expect(dimensions).toEqual({ width: 140, height: 60 })
    })

    it('returns 140x60 for scriptStep', () => {
      const dimensions = getNodeDimensions('scriptStep', 'bpmn')
      expect(dimensions).toEqual({ width: 140, height: 60 })
    })

    it('returns correct dimensions for v1 step types (no regression)', () => {
      // Test start/end events
      expect(getNodeDimensions('start', 'bpmn')).toEqual({ width: 30, height: 30 })
      expect(getNodeDimensions('end', 'bpmn')).toEqual({ width: 30, height: 30 })

      // Test gateways
      expect(getNodeDimensions('select1', 'bpmn')).toEqual({ width: 40, height: 50 })
      expect(getNodeDimensions('waitAny', 'bpmn')).toEqual({ width: 40, height: 50 })
      expect(getNodeDimensions('parallel', 'bpmn')).toEqual({ width: 40, height: 50 })
      expect(getNodeDimensions('waitAll', 'bpmn')).toEqual({ width: 40, height: 50 })

      // Test tasks
      expect(getNodeDimensions('actionProxyWait', 'bpmn')).toEqual({ width: 140, height: 60 })
      expect(getNodeDimensions('workflowProxy', 'bpmn')).toEqual({ width: 140, height: 60 })
    })
  })

  describe('ISA88 notation', () => {
    it('returns 130x50 for userInteractionStep', () => {
      const dimensions = getNodeDimensions('userInteractionStep', 'isa88')
      expect(dimensions).toEqual({ width: 130, height: 50 })
    })

    it('returns 130x50 for yesNoStep', () => {
      const dimensions = getNodeDimensions('yesNoStep', 'isa88')
      expect(dimensions).toEqual({ width: 130, height: 50 })
    })

    it('returns 130x50 for scriptStep', () => {
      const dimensions = getNodeDimensions('scriptStep', 'isa88')
      expect(dimensions).toEqual({ width: 130, height: 50 })
    })

    it('returns correct dimensions for v1 step types (no regression)', () => {
      // Test start/end
      expect(getNodeDimensions('start', 'isa88')).toEqual({ width: 30, height: 30 })
      expect(getNodeDimensions('end', 'isa88')).toEqual({ width: 30, height: 30 })

      // Test selection/parallel bars
      expect(getNodeDimensions('select1', 'isa88')).toEqual({ width: 60, height: 30 })
      expect(getNodeDimensions('waitAny', 'isa88')).toEqual({ width: 60, height: 30 })
      expect(getNodeDimensions('parallel', 'isa88')).toEqual({ width: 60, height: 30 })
      expect(getNodeDimensions('waitAll', 'isa88')).toEqual({ width: 60, height: 30 })

      // All step boxes uniform 130x50
      expect(getNodeDimensions('actionProxyWait', 'isa88')).toEqual({ width: 130, height: 50 })
      expect(getNodeDimensions('workflowProxy', 'isa88')).toEqual({ width: 130, height: 50 })
    })
  })

  describe('CATCH/RETURN match START/END (30x30)', () => {
    for (const notation of ['flowchart', 'bpmn', 'isa88'] as const) {
      it(`${notation}: catch is 30x30`, () => {
        expect(getNodeDimensions('catch', notation)).toEqual({ width: 30, height: 30 })
      })
      it(`${notation}: return is 30x30`, () => {
        expect(getNodeDimensions('return', notation)).toEqual({ width: 30, height: 30 })
      })
    }
  })
})
