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

// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { stepTypes, NotationSymbol, StepPalette } from '../StepPalette'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'

vi.mock('@/hooks/useCanEditActiveSpec', () => ({ useCanEditActiveSpec: vi.fn() }))

describe('StepPalette Integration', () => {
  describe('UI Step Types in Palette (INTG-01)', () => {
    it('includes userInteractionStep with label "User Interaction"', () => {
      const item = stepTypes.find((s) => s.type === 'userInteractionStep')
      expect(item).toBeDefined()
      expect(item!.label).toBe('User Interaction')
    })

    it('includes yesNoStep with label "Yes/No"', () => {
      const item = stepTypes.find((s) => s.type === 'yesNoStep')
      expect(item).toBeDefined()
      expect(item!.label).toBe('Yes/No')
    })

    it('includes User Interaction and Yes/No step types', () => {
      const uiTypes = ['userInteractionStep', 'yesNoStep']
      for (const type of uiTypes) {
        expect(stepTypes.find((s) => s.type === type)).toBeDefined()
      }
    })

    it('includes actionProxyWait with label "Environment Action"', () => {
      const item = stepTypes.find((s) => s.type === 'actionProxyWait')
      expect(item).toBeDefined()
      expect(item!.label).toBe('Environment Action')
    })

    it('includes scriptStep with label "Script"', () => {
      const item = stepTypes.find((s) => s.type === 'scriptStep')
      expect(item).toBeDefined()
      expect(item!.label).toBe('Script')
    })

    it('has 14 step types', () => {
      expect(stepTypes).toHaveLength(14)
    })

    it('includes gateStep with label "Gate"', () => {
      const item = stepTypes.find((s) => s.type === 'gateStep')
      expect(item).toBeDefined()
      expect(item!.label).toBe('Gate')
    })

    // Gate sits immediately after Child Workflow (spec 2026-08-30 palette follow-up) —
    // no longer after Script.
    it('places gateStep immediately after workflowProxy in the exported stepTypes order', () => {
      const gateIdx = stepTypes.findIndex((s) => s.type === 'gateStep')
      const workflowProxyIdx = stepTypes.findIndex((s) => s.type === 'workflowProxy')
      expect(gateIdx).toBeGreaterThan(-1)
      expect(workflowProxyIdx).toBeGreaterThan(-1)
      expect(gateIdx).toBe(workflowProxyIdx + 1)
    })

    it('places gateStep immediately after workflowProxy in the rendered DOM order', () => {
      vi.mocked(useCanEditActiveSpec).mockReturnValue(true)
      const { container } = render(createElement(ReactFlowProvider, null, createElement(StepPalette)))
      const labels = Array.from(container.querySelectorAll('[aria-label^="Add "]')).map((el) =>
        el.getAttribute('aria-label'),
      )
      const gateIdx = labels.indexOf('Add Gate step')
      const workflowProxyIdx = labels.indexOf('Add Child Workflow step')
      expect(gateIdx).toBeGreaterThan(-1)
      expect(workflowProxyIdx).toBeGreaterThan(-1)
      expect(gateIdx).toBe(workflowProxyIdx + 1)
    })

    it('includes catch with label "Catch"', () => {
      const item = stepTypes.find((s) => s.type === 'catch')
      expect(item).toBeDefined()
      expect(item!.label).toBe('Catch')
    })

    it('includes return with label "Return"', () => {
      const item = stepTypes.find((s) => s.type === 'return')
      expect(item).toBeDefined()
      expect(item!.label).toBe('Return')
    })

    it('all palette items have a type field matching valid NodeType', () => {
      const validTypes = [
        'start',
        'end',
        'actionProxyWait',
        'userInteractionStep',
        'yesNoStep',
        'scriptStep',
        'gateStep',
        'workflowProxy',
        'select1',
        'waitAny',
        'parallel',
        'waitAll',
        'catch',
        'return',
      ]
      for (const item of stepTypes) {
        expect(validTypes).toContain(item.type)
      }
    })

    it('does not include v2.0 types (instructionStep, textInputStep, pickOneStep, checkboxStep) in palette', () => {
      const removedTypes = ['instructionStep', 'textInputStep', 'pickOneStep', 'checkboxStep']
      for (const type of removedTypes) {
        expect(stepTypes.find((s) => s.type === type)).toBeUndefined()
      }
    })

    // CATCH/RETURN previously fell through to the gray fallback square; they now render
    // mini trapezoids matching the canvas CatchNode/ReturnNode shapes.
    it('renders trapezoid symbols (not the fallback) for catch and return', () => {
      for (const type of ['catch', 'return'] as const) {
        const { container } = render(createElement(NotationSymbol, { type, notation: 'flowchart' }))
        expect(container.querySelector('polygon')).not.toBeNull()
      }
    })

    // Gate is the first step type whose SHAPE differs per notation (spec 2026-08-29 §8.3):
    // flowchart/BPMN render a gateway diamond, ISA-88 renders the narrow double-bar transition
    // mark. None of them should fall through to the gray fallback square.
    it('renders a real symbol (not the fallback square) for gateStep across all notations', () => {
      for (const notation of ['flowchart', 'bpmn', 'isa88'] as const) {
        const { container } = render(createElement(NotationSymbol, { type: 'gateStep', notation }))
        expect(container.querySelector('svg')).not.toBeNull()
        expect(container.querySelector('div.bg-slate-300')).toBeNull()
      }
    })

    it('renders a diamond gateway shape for gateStep in flowchart and bpmn', () => {
      for (const notation of ['flowchart', 'bpmn'] as const) {
        const { container } = render(createElement(NotationSymbol, { type: 'gateStep', notation }))
        expect(container.querySelector('polygon')).not.toBeNull()
      }
    })

    it('renders the double-bar transition mark plus centre-line stems for gateStep in isa88', () => {
      const { container } = render(createElement(NotationSymbol, { type: 'gateStep', notation: 'isa88' }))
      // 2 horizontal bars + 2 thin vertical stems (matches the canvas GateNode geometry).
      expect(container.querySelectorAll('line')).toHaveLength(4)
      expect(container.querySelector('polygon')).toBeNull()
      // No "GATE" text at palette icon size (illegible at 24px).
      expect(container.querySelector('text')).toBeNull()
    })
  })
})
