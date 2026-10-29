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
import { validateFormDocument } from '@mission/form-schema'
import { importWorkflow } from '../workflow-importers'
import { hydrateFormLayouts } from '../form-layout-hydration'
import { CANVAS_DIMS } from '../canvas-dims'

/**
 * Form Layout Import Tests
 *
 * Tests verifying that form layout data is correctly hydrated
 * during import, including:
 * - FormLayouts hydration from form_layout_config
 * - Fresh element IDs on import (differ from exported)
 * - Position/size/fieldName/content/options preservation
 * - { content, plainText } unwrapping back to plain string
 * - Backward compat for raw string content
 * - Image src prefix stripping (stepOid- prefix removal)
 * - Round-trip fidelity (export then import)
 * - Missing form_layout_config handled gracefully
 * - Default canvas dimensions for missing device types
 *
 * P4.1 Task 5 refit (2026-07-23): the "round-trip" describes below used to build their
 * fixture via exportWorkflow(spec, nodes, edges) — where `nodes` carried the legacy
 * StepNodeData.formLayouts field — then fed the export straight back into
 * importWorkflow(). Since P4.1 Task 3, export reads only data.formDocument and never
 * emits form_layout_config, so that construction path no longer produces anything to
 * import (a v1-only node correctly exports NOTHING). Refit: each fixture is now a
 * literal form_layout_config wire array — the same shape the retired v1 exporter used
 * to emit (ids stripped; text/header content wrapped in { content, plainText }) — fed
 * directly to importWorkflow() via createUserInteractionJson(), mirroring the raw-JSON
 * style already used elsewhere in this file. Every pinned behavior (hydration
 * semantics) is unchanged; only the fixture-construction mechanism moved from
 * "export a v1 node" to "author the wire JSON export would have produced." See
 * task-5-report.md for the full refit table.
 *
 * P4.2 Task 3 refit (2026-07-23): the legacy import branch no longer persists
 * `nodeData.formLayouts` at all — it hydrates to a local var purely to feed the v1→v2
 * converter, then mints `formDocument` (the v1 editor is retired, so nothing downstream
 * ever reads a persisted formLayouts again). The hydration-semantics describes below
 * (fresh ids, position/field preservation, content unwrapping, image prefix stripping,
 * canvas-dims fallback, param bindings, round-trips, timer) now call
 * `hydrateFormLayouts(formLayoutConfig, stepOid)` directly — still exported, logic
 * byte-unchanged — instead of routing through importWorkflow() and reading the
 * no-longer-produced nodeData.formLayouts. Every pinned assertion is unchanged; only
 * the invocation vehicle moved. The remaining importWorkflow()-based describes ("Basic
 * hydration"'s wiring test, "P4.1 form_document import", "P4.2 legacy conversion
 * minting") pin what actually lands on nodeData after a real import.
 */

// =============================================================================
// Test Helpers
// =============================================================================

// Standard v4.0 workflow JSON with a USER_INTERACTION step containing form_layout_config
function createUserInteractionJson(stepOid: string, formLayoutConfig: unknown[]) {
  return {
    local_id: 'Test Workflow',
    oid: 'wf-test-001',
    version: '1.0.0',
    last_modified_date: new Date().toISOString(),
    schemaVersion: '4.0',
    steps: [
      {
        local_id: 'User Interaction Step',
        oid: stepOid,
        version: '1.0.0',
        last_modified_date: new Date().toISOString(),
        step_type: 'USER_INTERACTION',
        form_layout_config: formLayoutConfig,
      },
    ],
    connections: [],
  }
}

// =============================================================================
// Form Layout Import Tests
// =============================================================================

describe('Form Layout Import', () => {
  describe('Basic hydration', () => {
    it('legacy form_layout_config converts to formDocument on a userInteractionStep node (no formLayouts persisted)', () => {
      const json = createUserInteractionJson('step-001', [
        { deviceType: 'phone', canvasWidth: 390, canvasHeight: 844, elements: [] },
        { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
      ])

      const result = importWorkflow(json)

      expect('nodes' in result).toBe(true)
      if ('nodes' in result) {
        const node = result.nodes[0]
        expect(node.type).toBe('userInteractionStep')
        // P4.2: import no longer persists nodeData.formLayouts (v1 editor retired) —
        // it mints formDocument via the converter instead.
        expect(node.data.formLayouts).toBeUndefined()
        expect(node.data.formDocument).toBeDefined()
      }
    })

    it('imports correct canvasWidth and canvasHeight for each device', () => {
      const fl = hydrateFormLayouts(
        [
          { deviceType: 'phone', canvasWidth: 390, canvasHeight: 844, elements: [] },
          { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
          { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        ],
        'step-001',
      )!

      expect(fl.phone.canvasWidth).toBe(390)
      expect(fl.phone.canvasHeight).toBe(844)
      expect(fl.tablet.canvasWidth).toBe(768)
      expect(fl.tablet.canvasHeight).toBe(1024)
      expect(fl.desktop.canvasWidth).toBe(768)
      expect(fl.desktop.canvasHeight).toBe(1024)
    })

    it('formLayouts is undefined when step has no form_layout_config', () => {
      const json = {
        local_id: 'Test Workflow',
        oid: 'wf-test-001',
        version: '1.0.0',
        last_modified_date: new Date().toISOString(),
        schemaVersion: '4.0',
        steps: [
          {
            local_id: 'Action Step',
            oid: 'step-001',
            version: '1.0.0',
            last_modified_date: new Date().toISOString(),
            step_type: 'WAIT ACTION PROXY',
          },
        ],
        connections: [],
      }

      const result = importWorkflow(json)

      expect('nodes' in result).toBe(true)
      if ('nodes' in result) {
        expect(result.nodes[0].data.formLayouts).toBeUndefined()
      }
    })
  })

  describe('Fresh element IDs on import', () => {
    it('imported element IDs are fresh (differ from any source IDs)', () => {
      const fl = hydrateFormLayouts(
        [
          {
            deviceType: 'phone',
            canvasWidth: 390,
            canvasHeight: 844,
            elements: [
              // Note: exported elements have no id (stripped on export)
              // This simulates importing an already-exported JSON
              {
                type: 'text',
                content: { content: 'Hello', plainText: 'Hello' },
                x: 10,
                y: 20,
                width: 200,
                height: 40,
              },
              { type: 'button', label: 'Submit', outputValue: 'submit', x: 10, y: 700, width: 370, height: 50 },
            ],
          },
          { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
          { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        ],
        'step-001',
      )!

      const elements = fl.phone.elements
      expect(elements).toHaveLength(2)

      // All elements must have fresh IDs
      for (const el of elements) {
        expect(el.id).toBeTruthy()
        expect(typeof el.id).toBe('string')
        expect(el.id.length).toBeGreaterThan(0)
      }

      // IDs must be unique
      expect(elements[0].id).not.toBe(elements[1].id)
    })

    it('the i-th element across phone/tablet/desktop shares the same id (cross-layout sync depends on it)', () => {
      // Regression: hydrateFormLayouts used to generateOID per layout, which
      // gave one logical element three different ids and broke updateElement's
      // cross-layout sync (e.g. a video `src` set on one layout never
      // propagated to the others, so exports showed empty URLs in 2 of 3
      // layouts — the user-reported "Video URL not in exported package" bug).
      const fl = hydrateFormLayouts(
        [
          {
            deviceType: 'phone',
            canvasWidth: 390,
            canvasHeight: 844,
            elements: [
              { type: 'video', src: 'https://example.com/v.mp4', x: 0, y: 0, width: 100, height: 60 },
              { type: 'image', src: 'thumb.png', imageOid: '999', x: 0, y: 70, width: 100, height: 60 },
            ],
          },
          {
            deviceType: 'tablet',
            canvasWidth: 768,
            canvasHeight: 1024,
            elements: [
              { type: 'video', src: 'https://example.com/v.mp4', x: 0, y: 0, width: 200, height: 120 },
              { type: 'image', src: 'thumb.png', imageOid: '999', x: 0, y: 130, width: 200, height: 120 },
            ],
          },
          {
            deviceType: 'desktop',
            canvasWidth: 1280,
            canvasHeight: 800,
            elements: [
              { type: 'video', src: 'https://example.com/v.mp4', x: 0, y: 0, width: 400, height: 240 },
              { type: 'image', src: 'thumb.png', imageOid: '999', x: 0, y: 250, width: 400, height: 240 },
            ],
          },
        ],
        'step-001',
      )!

      expect(fl.phone.elements[0].id).toBe(fl.tablet.elements[0].id)
      expect(fl.phone.elements[0].id).toBe(fl.desktop.elements[0].id)
      expect(fl.phone.elements[1].id).toBe(fl.tablet.elements[1].id)
      expect(fl.phone.elements[1].id).toBe(fl.desktop.elements[1].id)
      // Different elements get different ids.
      expect(fl.phone.elements[0].id).not.toBe(fl.phone.elements[1].id)
    })

    it('imported IDs are valid snowflake OIDs (not short strings)', () => {
      const fl = hydrateFormLayouts(
        [
          {
            deviceType: 'phone',
            canvasWidth: 390,
            canvasHeight: 844,
            elements: [
              { type: 'text', content: { content: 'Test', plainText: 'Test' }, x: 0, y: 0, width: 100, height: 40 },
            ],
          },
          { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
          { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        ],
        'step-001',
      )!

      const el = fl.phone.elements[0]
      // Snowflake OIDs are long strings (typically 18+ chars)
      expect(el.id.length).toBeGreaterThan(8)
    })
  })

  describe('Position, size, and field data preservation', () => {
    it('preserves element x, y, width, height on import', () => {
      const fl = hydrateFormLayouts(
        [
          {
            deviceType: 'phone',
            canvasWidth: 390,
            canvasHeight: 844,
            elements: [{ type: 'textInput', fieldName: 'email', x: 15, y: 120, width: 360, height: 48 }],
          },
          { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
          { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        ],
        'step-001',
      )!

      const el = fl.phone.elements[0]
      expect(el.x).toBe(15)
      expect(el.y).toBe(120)
      expect(el.width).toBe(360)
      expect(el.height).toBe(48)
    })

    it('preserves fieldName on textInput elements', () => {
      const fl = hydrateFormLayouts(
        [
          {
            deviceType: 'phone',
            canvasWidth: 390,
            canvasHeight: 844,
            elements: [{ type: 'textInput', fieldName: 'phoneNumber', x: 0, y: 0, width: 370, height: 44 }],
          },
          { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
          { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        ],
        'step-001',
      )!

      const el = fl.phone.elements[0]
      expect(el.type).toBe('textInput')
      if (el.type === 'textInput') {
        expect(el.fieldName).toBe('phoneNumber')
      }
    })

    it('preserves options on checkbox elements', () => {
      const fl = hydrateFormLayouts(
        [
          {
            deviceType: 'phone',
            canvasWidth: 390,
            canvasHeight: 844,
            elements: [
              {
                type: 'checkbox',
                fieldName: 'toppings',
                options: ['Pepperoni', 'Mushrooms', 'Olives'],
                x: 0,
                y: 0,
                width: 370,
                height: 80,
              },
            ],
          },
          { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
          { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        ],
        'step-001',
      )!

      const el = fl.phone.elements[0]
      expect(el.type).toBe('checkbox')
      if (el.type === 'checkbox') {
        expect(el.fieldName).toBe('toppings')
        expect(el.options).toEqual([
          { label: 'Pepperoni', value: 'Pepperoni' },
          { label: 'Mushrooms', value: 'Mushrooms' },
          { label: 'Olives', value: 'Olives' },
        ])
      }
    })

    it('preserves button label and outputValue', () => {
      const fl = hydrateFormLayouts(
        [
          {
            deviceType: 'phone',
            canvasWidth: 390,
            canvasHeight: 844,
            elements: [
              {
                type: 'button',
                label: 'Confirm Order',
                outputValue: 'confirmed',
                x: 10,
                y: 700,
                width: 370,
                height: 50,
              },
            ],
          },
          { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
          { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        ],
        'step-001',
      )!

      const el = fl.phone.elements[0]
      expect(el.type).toBe('button')
      if (el.type === 'button') {
        expect(el.label).toBe('Confirm Order')
        expect(el.outputValue).toBe('confirmed')
      }
    })
  })

  describe('Text/Header content unwrapping', () => {
    it('unwraps { content, plainText } back to plain string for text elements', () => {
      const fl = hydrateFormLayouts(
        [
          {
            deviceType: 'phone',
            canvasWidth: 390,
            canvasHeight: 844,
            elements: [
              {
                type: 'text',
                content: { content: 'Hello World', plainText: 'Hello World' },
                x: 0,
                y: 0,
                width: 200,
                height: 40,
              },
            ],
          },
          { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
          { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        ],
        'step-001',
      )!

      const el = fl.phone.elements[0]
      expect(el.type).toBe('text')
      if (el.type === 'text') {
        expect(typeof el.content).toBe('string')
        expect(el.content).toBe('Hello World')
      }
    })

    it('unwraps { content, plainText } back to plain string for header elements', () => {
      const fl = hydrateFormLayouts(
        [
          {
            deviceType: 'phone',
            canvasWidth: 390,
            canvasHeight: 844,
            elements: [
              {
                type: 'header',
                content: { content: 'Welcome Header', plainText: 'Welcome Header' },
                x: 0,
                y: 0,
                width: 400,
                height: 60,
              },
            ],
          },
          { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
          { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        ],
        'step-001',
      )!

      const el = fl.phone.elements[0]
      expect(el.type).toBe('header')
      if (el.type === 'header') {
        expect(typeof el.content).toBe('string')
        expect(el.content).toBe('Welcome Header')
      }
    })

    it('handles raw string content for backward compatibility (text element)', () => {
      const fl = hydrateFormLayouts(
        [
          {
            deviceType: 'phone',
            canvasWidth: 390,
            canvasHeight: 844,
            elements: [
              // Raw string content (not wrapped in { content, plainText })
              { type: 'text', content: 'Plain string content', x: 0, y: 0, width: 200, height: 40 },
            ],
          },
          { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
          { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        ],
        'step-001',
      )!

      const el = fl.phone.elements[0]
      expect(el.type).toBe('text')
      if (el.type === 'text') {
        expect(typeof el.content).toBe('string')
        expect(el.content).toBe('Plain string content')
      }
    })
  })

  describe('Image prefix stripping', () => {
    it('strips stepOid prefix from image src on import', () => {
      const stepOid = 'step-myStep001'
      const fl = hydrateFormLayouts(
        [
          {
            deviceType: 'phone',
            canvasWidth: 390,
            canvasHeight: 844,
            elements: [
              // ZIP stores images as {stepOid}-{filename}
              { type: 'image', src: `${stepOid}-photo.png`, x: 0, y: 0, width: 200, height: 150 },
            ],
          },
          { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
          { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        ],
        stepOid,
      )!

      const el = fl.phone.elements[0]
      expect(el.type).toBe('image')
      if (el.type === 'image') {
        // Prefix stripped -- only filename remains
        expect(el.src).toBe('photo.png')
      }
    })

    it('does not strip prefix from https:// image sources', () => {
      const stepOid = 'step-abc'
      const fl = hydrateFormLayouts(
        [
          {
            deviceType: 'phone',
            canvasWidth: 390,
            canvasHeight: 844,
            elements: [
              { type: 'image', src: 'https://cdn.example.com/photo.jpg', x: 0, y: 0, width: 200, height: 150 },
            ],
          },
          { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
          { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        ],
        stepOid,
      )!

      const el = fl.phone.elements[0]
      expect(el.type).toBe('image')
      if (el.type === 'image') {
        expect(el.src).toBe('https://cdn.example.com/photo.jpg')
      }
    })
  })

  describe('Default canvas dimensions fallback', () => {
    it('falls back to current CANVAS_DIMS.phone when phone layout is missing', () => {
      const fl = hydrateFormLayouts(
        [
          // Only tablet and desktop supplied
          { deviceType: 'tablet', canvasWidth: 1280, canvasHeight: 720, elements: [] },
          { deviceType: 'desktop', canvasWidth: 1024, canvasHeight: 768, elements: [] },
        ],
        'step-001',
      )!

      expect(fl.phone.canvasWidth).toBe(CANVAS_DIMS.phone.w)
      expect(fl.phone.canvasHeight).toBe(CANVAS_DIMS.phone.h)
      expect(fl.phone.elements).toHaveLength(0)
    })

    it('falls back to current CANVAS_DIMS.tablet when tablet layout is missing', () => {
      const fl = hydrateFormLayouts(
        [
          { deviceType: 'phone', canvasWidth: 360, canvasHeight: 800, elements: [] },
          { deviceType: 'desktop', canvasWidth: 1024, canvasHeight: 768, elements: [] },
        ],
        'step-001',
      )!

      expect(fl.tablet.canvasWidth).toBe(CANVAS_DIMS.tablet.w)
      expect(fl.tablet.canvasHeight).toBe(CANVAS_DIMS.tablet.h)
    })

    it('falls back to current CANVAS_DIMS.desktop when desktop layout is missing', () => {
      const fl = hydrateFormLayouts(
        [
          { deviceType: 'phone', canvasWidth: 360, canvasHeight: 800, elements: [] },
          { deviceType: 'tablet', canvasWidth: 1280, canvasHeight: 720, elements: [] },
        ],
        'step-001',
      )!

      expect(fl.desktop.canvasWidth).toBe(CANVAS_DIMS.desktop.w)
      expect(fl.desktop.canvasHeight).toBe(CANVAS_DIMS.desktop.h)
    })
  })
})

// =============================================================================
// PARAM-05: Parameter Binding Import Tests
// =============================================================================

describe('PARAM-05: parameter binding import', () => {
  it('imports textInput outputParameter from form_layout_config', () => {
    const fl = hydrateFormLayouts(
      [
        {
          deviceType: 'phone',
          canvasWidth: 390,
          canvasHeight: 844,
          elements: [
            {
              type: 'textInput',
              fieldName: 'reading',
              outputParameter: 'sensor.reading',
              x: 0,
              y: 0,
              width: 370,
              height: 44,
            },
          ],
        },
        { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
      ],
      'step-001',
    )!

    const el = fl.phone.elements[0]
    expect(el.type).toBe('textInput')
    if (el.type === 'textInput') {
      expect(el.outputParameter).toBe('sensor.reading')
    }
  })

  it('imports textInput defaultSource with static mode', () => {
    const fl = hydrateFormLayouts(
      [
        {
          deviceType: 'phone',
          canvasWidth: 390,
          canvasHeight: 844,
          elements: [
            {
              type: 'textInput',
              fieldName: 'note',
              defaultSource: { mode: 'static', value: 'default text' },
              x: 0,
              y: 0,
              width: 370,
              height: 44,
            },
          ],
        },
        { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
      ],
      'step-001',
    )!

    const el = fl.phone.elements[0]
    expect(el.type).toBe('textInput')
    if (el.type === 'textInput') {
      expect(el.defaultSource).toEqual({ mode: 'static', value: 'default text' })
    }
  })

  it('imports textarea defaultSource with legacy parameter mode migrated to property', () => {
    const fl = hydrateFormLayouts(
      [
        {
          deviceType: 'phone',
          canvasWidth: 390,
          canvasHeight: 844,
          elements: [
            {
              type: 'textarea',
              fieldName: 'batchNote',
              defaultSource: { mode: 'parameter', value: 'batch.id' },
              x: 0,
              y: 0,
              width: 370,
              height: 120,
            },
          ],
        },
        { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
      ],
      'step-001',
    )!

    const el = fl.phone.elements[0]
    expect(el.type).toBe('textarea')
    if (el.type === 'textarea') {
      expect(el.defaultSource).toEqual({ mode: 'property', value: 'batch.id' })
    }
  })

  it('imports element without bindings (no outputParameter or defaultSource)', () => {
    const fl = hydrateFormLayouts(
      [
        {
          deviceType: 'phone',
          canvasWidth: 390,
          canvasHeight: 844,
          elements: [{ type: 'textInput', fieldName: 'plainField', x: 0, y: 0, width: 370, height: 44 }],
        },
        { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
      ],
      'step-001',
    )!

    const el = fl.phone.elements[0]
    expect(el.type).toBe('textInput')
    if (el.type === 'textInput') {
      expect(el.outputParameter).toBeUndefined()
      expect(el.defaultSource).toBeUndefined()
    }
  })
})

// =============================================================================
// PARAM-05: Parameter Binding Round-Trip Tests
// =============================================================================

describe('PARAM-05: parameter binding round-trip', () => {
  // Wire-format mirror of what the (retired) v1 exporter emitted for a form with bound
  // textInput/textarea fields — ids stripped — fed straight to hydrateFormLayouts()
  // instead of round-tripping through exportWorkflow().
  const paramRoundTripFormLayoutConfig = [
    {
      deviceType: 'phone',
      canvasWidth: 390,
      canvasHeight: 844,
      elements: [
        {
          type: 'textInput',
          fieldName: 'bloodPressure',
          x: 10,
          y: 100,
          width: 370,
          height: 44,
          outputParameter: 'patient.bloodPressure',
          defaultSource: { mode: 'static', value: '120/80' },
        },
        {
          type: 'textarea',
          fieldName: 'notes',
          x: 10,
          y: 160,
          width: 370,
          height: 120,
          outputParameter: 'patient.notes',
          defaultSource: { mode: 'property', value: 'patient.previousNotes' },
        },
        {
          type: 'textInput',
          fieldName: 'plain',
          x: 10,
          y: 300,
          width: 370,
          height: 44,
          // no outputParameter, no defaultSource
        },
      ],
    },
    { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
    { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
  ]

  it('round-trip preserves outputParameter on textInput', () => {
    const fl = hydrateFormLayouts(paramRoundTripFormLayoutConfig, 'step-001')!

    const el = fl.phone.elements.find((e) => e.type === 'textInput' && e.fieldName === 'bloodPressure')
    expect(el).toBeDefined()
    if (el?.type === 'textInput') {
      expect(el.outputParameter).toBe('patient.bloodPressure')
    }
  })

  it('round-trip preserves defaultSource static mode on textInput', () => {
    const fl = hydrateFormLayouts(paramRoundTripFormLayoutConfig, 'step-001')!

    const el = fl.phone.elements.find((e) => e.type === 'textInput' && e.fieldName === 'bloodPressure')
    expect(el).toBeDefined()
    if (el?.type === 'textInput') {
      expect(el.defaultSource).toEqual({ mode: 'static', value: '120/80' })
    }
  })

  it('round-trip migrates legacy parameter mode to property on textarea', () => {
    const fl = hydrateFormLayouts(paramRoundTripFormLayoutConfig, 'step-001')!

    const el = fl.phone.elements.find((e) => e.type === 'textarea')
    expect(el).toBeDefined()
    if (el?.type === 'textarea') {
      expect(el.outputParameter).toBe('patient.notes')
      expect(el.defaultSource).toEqual({ mode: 'property', value: 'patient.previousNotes' })
    }
  })

  it('round-trip: textInput without bindings has no outputParameter or defaultSource', () => {
    const fl = hydrateFormLayouts(paramRoundTripFormLayoutConfig, 'step-001')!

    const el = fl.phone.elements.find((e) => e.type === 'textInput' && e.fieldName === 'plain')
    expect(el).toBeDefined()
    if (el?.type === 'textInput') {
      expect(el.outputParameter).toBeUndefined()
      expect(el.defaultSource).toBeUndefined()
    }
  })
})

// =============================================================================
// Round-Trip Tests
// =============================================================================

describe('Form Layout Export/Import Round-Trip', () => {
  // Wire-format mirror of the (retired) v1 exporter's output for a 5-element phone form
  // plus a tablet text and a desktop header — ids stripped, text/header content wrapped
  // in { content, plainText } (the exporter's RichTextContent format; hydrateFormLayouts
  // unwraps it back to a plain string on import).
  const testFormLayoutConfig = [
    {
      deviceType: 'phone',
      canvasWidth: 390,
      canvasHeight: 844,
      elements: [
        { type: 'text', content: { content: 'Hello', plainText: 'Hello' }, x: 10, y: 20, width: 200, height: 40 },
        { type: 'button', label: 'Submit', outputValue: 'submit', x: 10, y: 700, width: 370, height: 50 },
        { type: 'textInput', fieldName: 'firstName', x: 10, y: 100, width: 370, height: 44 },
        {
          type: 'checkbox',
          fieldName: 'toppings',
          options: [
            { label: 'A', value: 'A' },
            { label: 'B', value: 'B' },
          ],
          x: 10,
          y: 400,
          width: 370,
          height: 80,
        },
        {
          type: 'radio',
          fieldName: 'size',
          options: [
            { label: 'S', value: 'S' },
            { label: 'M', value: 'M' },
            { label: 'L', value: 'L' },
          ],
          x: 10,
          y: 500,
          width: 370,
          height: 80,
        },
      ],
    },
    {
      deviceType: 'tablet',
      canvasWidth: 768,
      canvasHeight: 1024,
      elements: [
        {
          type: 'text',
          content: { content: 'Tablet Hello', plainText: 'Tablet Hello' },
          x: 20,
          y: 30,
          width: 400,
          height: 50,
        },
      ],
    },
    {
      deviceType: 'desktop',
      canvasWidth: 768,
      canvasHeight: 1024,
      elements: [
        { type: 'header', content: { content: 'Welcome', plainText: 'Welcome' }, x: 40, y: 20, width: 600, height: 60 },
      ],
    },
  ]

  // Original v1 element ids (stripped on export) — pins that fresh, never-passed-through
  // ids come back on import (see "IDs differ" below).
  const originalV1Ids = ['el-1', 'el-2', 'el-3', 'el-4', 'el-5', 'el-6', 'el-7']

  it('round-trip preserves formLayouts structure (ignoring IDs)', () => {
    const fl = hydrateFormLayouts(testFormLayoutConfig, 'step-001')!

    // Phone: 5 elements
    expect(fl.phone.elements).toHaveLength(5)
    expect(fl.phone.canvasWidth).toBe(390)
    expect(fl.phone.canvasHeight).toBe(844)

    // Tablet: 1 element
    expect(fl.tablet.elements).toHaveLength(1)
    expect(fl.tablet.canvasWidth).toBe(768)
    expect(fl.tablet.canvasHeight).toBe(1024)

    // Desktop: 1 element
    expect(fl.desktop.elements).toHaveLength(1)
    expect(fl.desktop.canvasWidth).toBe(768)
    expect(fl.desktop.canvasHeight).toBe(1024)
  })

  it('round-trip: IDs differ from original (fresh on import)', () => {
    const fl = hydrateFormLayouts(testFormLayoutConfig, 'step-001')!
    const phoneElements = fl.phone.elements

    for (const el of phoneElements) {
      // Imported IDs must differ from original source IDs
      expect(originalV1Ids).not.toContain(el.id)
    }
  })

  it('round-trip: text content is plain string after import', () => {
    const fl = hydrateFormLayouts(testFormLayoutConfig, 'step-001')!
    const phoneElements = fl.phone.elements
    const textEl = phoneElements.find((e) => e.type === 'text')

    expect(textEl).toBeDefined()
    if (textEl?.type === 'text') {
      // After round-trip, content must be a plain string (not { content, plainText })
      expect(typeof textEl.content).toBe('string')
      expect(textEl.content).toBe('Hello')
    }
  })

  it('round-trip: header content is plain string after import', () => {
    const fl = hydrateFormLayouts(testFormLayoutConfig, 'step-001')!
    const desktopElements = fl.desktop.elements
    const headerEl = desktopElements.find((e) => e.type === 'header')

    expect(headerEl).toBeDefined()
    if (headerEl?.type === 'header') {
      expect(typeof headerEl.content).toBe('string')
      expect(headerEl.content).toBe('Welcome')
    }
  })

  it('round-trip: fieldName preserved on textInput', () => {
    const fl = hydrateFormLayouts(testFormLayoutConfig, 'step-001')!
    const phoneElements = fl.phone.elements
    const textInputEl = phoneElements.find((e) => e.type === 'textInput')

    expect(textInputEl).toBeDefined()
    if (textInputEl?.type === 'textInput') {
      expect(textInputEl.fieldName).toBe('firstName')
    }
  })

  it('round-trip: button label and outputValue preserved', () => {
    const fl = hydrateFormLayouts(testFormLayoutConfig, 'step-001')!
    const phoneElements = fl.phone.elements
    const buttonEl = phoneElements.find((e) => e.type === 'button')

    expect(buttonEl).toBeDefined()
    if (buttonEl?.type === 'button') {
      expect(buttonEl.label).toBe('Submit')
      expect(buttonEl.outputValue).toBe('submit')
    }
  })

  it('round-trip: checkbox fieldName and options preserved', () => {
    const fl = hydrateFormLayouts(testFormLayoutConfig, 'step-001')!
    const phoneElements = fl.phone.elements
    const checkboxEl = phoneElements.find((e) => e.type === 'checkbox')

    expect(checkboxEl).toBeDefined()
    if (checkboxEl?.type === 'checkbox') {
      expect(checkboxEl.fieldName).toBe('toppings')
      expect(checkboxEl.options).toEqual([
        { label: 'A', value: 'A' },
        { label: 'B', value: 'B' },
      ])
    }
  })

  it('round-trip: radio fieldName and options preserved', () => {
    const fl = hydrateFormLayouts(testFormLayoutConfig, 'step-001')!
    const phoneElements = fl.phone.elements
    const radioEl = phoneElements.find((e) => e.type === 'radio')

    expect(radioEl).toBeDefined()
    if (radioEl?.type === 'radio') {
      expect(radioEl.fieldName).toBe('size')
      expect(radioEl.options).toEqual([
        { label: 'S', value: 'S' },
        { label: 'M', value: 'M' },
        { label: 'L', value: 'L' },
      ])
    }
  })
})

// =============================================================================
// RTEXT-06: Rich Text Import and Round-Trip Tests
// =============================================================================

describe('RTEXT-06: rich text import and round-trip', () => {
  it('imports HTML content from { content, plainText } wrapper', () => {
    const fl = hydrateFormLayouts(
      [
        {
          deviceType: 'phone',
          canvasWidth: 390,
          canvasHeight: 844,
          elements: [
            {
              type: 'text',
              content: { content: '<p><strong>Bold</strong></p>', plainText: 'Bold' },
              x: 0,
              y: 0,
              width: 200,
              height: 40,
            },
          ],
        },
        { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
      ],
      'step-001',
    )!

    const el = fl.phone.elements[0]
    expect(el.type).toBe('text')
    if (el.type === 'text') {
      // Import extracts the content (HTML) field from the wrapper
      expect(el.content).toBe('<p><strong>Bold</strong></p>')
    }
  })

  it('imports HTML with parameter chip spans intact', () => {
    const fl = hydrateFormLayouts(
      [
        {
          deviceType: 'phone',
          canvasWidth: 390,
          canvasHeight: 844,
          elements: [
            {
              type: 'text',
              content: {
                content: '<p>Hi <span data-param-chip="user.name"></span></p>',
                plainText: 'Hi <user.name>',
              },
              x: 0,
              y: 0,
              width: 200,
              height: 40,
            },
          ],
        },
        { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
      ],
      'step-001',
    )!

    const el = fl.phone.elements[0]
    expect(el.type).toBe('text')
    if (el.type === 'text') {
      expect(el.content).toBe('<p>Hi <span data-param-chip="user.name"></span></p>')
    }
  })

  it('backward compat: imports plain string content (no wrapper)', () => {
    const fl = hydrateFormLayouts(
      [
        {
          deviceType: 'phone',
          canvasWidth: 390,
          canvasHeight: 844,
          elements: [{ type: 'text', content: 'Legacy plain text', x: 0, y: 0, width: 200, height: 40 }],
        },
        { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
      ],
      'step-001',
    )!

    const el = fl.phone.elements[0]
    expect(el.type).toBe('text')
    if (el.type === 'text') {
      expect(el.content).toBe('Legacy plain text')
    }
  })

  it('round-trip preserves HTML formatting on text element', () => {
    const html = '<p><strong>Bold</strong> <em>italic</em> <u>underline</u></p>'
    const fl = hydrateFormLayouts(
      [
        {
          deviceType: 'phone',
          canvasWidth: 390,
          canvasHeight: 844,
          elements: [
            {
              type: 'text',
              content: { content: html, plainText: 'Bold italic underline' },
              x: 10,
              y: 20,
              width: 200,
              height: 40,
            },
          ],
        },
        { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
      ],
      'step-001',
    )!

    const el = fl.phone.elements[0]
    expect(el.type).toBe('text')
    if (el.type === 'text') {
      expect(el.content).toBe(html)
    }
  })

  it('round-trip preserves parameter chip HTML on text element', () => {
    const html =
      '<p>Hello <span data-param-chip="patient.name"></span>, your BP is <span data-param-chip="vitals.bp"></span></p>'
    const fl = hydrateFormLayouts(
      [
        {
          deviceType: 'phone',
          canvasWidth: 390,
          canvasHeight: 844,
          elements: [
            {
              type: 'text',
              content: { content: html, plainText: 'Hello <patient.name>, your BP is <vitals.bp>' },
              x: 10,
              y: 20,
              width: 200,
              height: 40,
            },
          ],
        },
        { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
      ],
      'step-001',
    )!

    const el = fl.phone.elements[0]
    expect(el.type).toBe('text')
    if (el.type === 'text') {
      expect(el.content).toBe(html)
    }
  })

  it('round-trip preserves rich text on header element', () => {
    const html = '<p><strong>Section: <span data-param-chip="step.title"></span></strong></p>'
    const fl = hydrateFormLayouts(
      [
        { deviceType: 'phone', canvasWidth: 390, canvasHeight: 844, elements: [] },
        { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        {
          deviceType: 'desktop',
          canvasWidth: 768,
          canvasHeight: 1024,
          elements: [
            {
              type: 'header',
              content: { content: html, plainText: 'Section: <step.title>' },
              x: 40,
              y: 20,
              width: 600,
              height: 60,
            },
          ],
        },
      ],
      'step-001',
    )!

    const el = fl.desktop.elements[0]
    expect(el.type).toBe('header')
    if (el.type === 'header') {
      expect(el.content).toBe(html)
    }
  })
})

describe('TIMER-05: timer element round-trip', () => {
  it('preserves timer properties through export-then-import', () => {
    // Wire-format mirror of the (retired) v1 exporter's output for a single timer
    // element — id stripped, fed straight to hydrateFormLayouts().
    const fl = hydrateFormLayouts(
      [
        {
          deviceType: 'phone',
          canvasWidth: 390,
          canvasHeight: 844,
          elements: [
            {
              type: 'timer',
              label: 'Count Up Timer',
              fieldName: 'timer_elapsed',
              durationSeconds: 120,
              direction: 'countup',
              blockDone: false,
              x: 0,
              y: 0,
              width: 300,
              height: 140,
            },
          ],
        },
        { deviceType: 'tablet', canvasWidth: 768, canvasHeight: 1024, elements: [] },
        { deviceType: 'desktop', canvasWidth: 768, canvasHeight: 1024, elements: [] },
      ],
      'step-001',
    )!

    // Find the timer element in the hydrated form layouts
    const phoneElements = fl.phone.elements
    const timer = phoneElements.find((e) => e.type === 'timer')

    expect(timer).toBeDefined()
    expect(timer!.type).toBe('timer')
    // ID should be freshly minted (never the old v1 fixture id)
    expect(timer!.id).not.toBe('el-timer-rt')
    expect(timer!.id.length).toBeGreaterThan(0)

    // All timer-specific properties preserved
    expect(timer!.label).toBe('Count Up Timer')
    expect(timer!.fieldName).toBe('timer_elapsed')
    expect(timer!.durationSeconds).toBe(120)
    expect(timer!.direction).toBe('countup')
    expect(timer!.blockDone).toBe(false)
  })
})

describe('P4.1 form_document import (native 5.0 path)', () => {
  const nativeDoc = {
    version: 2,
    sections: [
      {
        id: 'content',
        role: 'content',
        rows: [{ id: 'r1', blocks: [{ id: 'b1', type: 'text', content: '<b>Hi</b>' }] }],
      },
    ],
  }
  const step = (extra: Record<string, unknown>) => ({
    local_id: 's1',
    oid: 'S1',
    version: '1.0.0',
    last_modified_date: '2026-07-23T00:00:00.000Z',
    step_type: 'USER_INTERACTION',
    ...extra,
  })
  const spec = (stepExtra: Record<string, unknown>) => ({
    schemaVersion: '5.0',
    local_id: 'wf',
    oid: 'WF1',
    version: '1.0.0',
    last_modified_date: '2026-07-23T00:00:00.000Z',
    steps: [step(stepExtra)],
    connections: [],
  })

  it('sets nodeData.formDocument verbatim (ids kept) and does NOT hydrate formLayouts', () => {
    const result = importWorkflow(spec({ form_document: nativeDoc }))
    expect('error' in result).toBe(false)
    const data = (result as { nodes: Array<{ data: Record<string, unknown> }> }).nodes[0].data
    expect(data.formDocument).toEqual(nativeDoc)
    expect(validateFormDocument(data.formDocument).ok).toBe(true)
    expect(data.formLayouts).toBeUndefined()
  })

  it('rejects an invalid form_document loudly', () => {
    const bad = { version: 2, sections: [{ id: 'c', role: 'bogus', rows: [] }] }
    const result = importWorkflow(spec({ form_document: bad }))
    expect('error' in result && /form_document/.test((result as { error: string }).error)).toBe(true)
  })
})

describe('P4.2 legacy conversion minting (4.0 path)', () => {
  it('mints formDocument only (formLayouts is never persisted) and preserves custom Yes/No labels', () => {
    const legacySpec = {
      schemaVersion: '4.0',
      local_id: 'wf',
      oid: 'WF1',
      version: '1.0.0',
      last_modified_date: '2026-07-23T00:00:00.000Z',
      connections: [],
      steps: [
        {
          local_id: 's1',
          oid: 'S1',
          version: '1.0.0',
          last_modified_date: '2026-07-23T00:00:00.000Z',
          step_type: 'YES_NO',
          yes_no_config: { yes_label: 'Yes', no_label: 'No', yes_value: 'true', no_value: 'false' },
          form_layout_config: (['phone', 'tablet', 'desktop'] as const).map((deviceType) => ({
            deviceType,
            canvasWidth: 768,
            canvasHeight: 1024,
            elements: [
              { type: 'text', content: { content: 'Hi', plainText: 'Hi' }, x: 40, y: 40, width: 400, height: 30 },
              {
                type: 'button',
                label: 'Proceed',
                outputValue: 'true',
                deletable: false,
                x: 200,
                y: 900,
                width: 120,
                height: 44,
              },
              {
                type: 'button',
                label: 'Abort',
                outputValue: 'false',
                deletable: false,
                x: 340,
                y: 900,
                width: 120,
                height: 44,
              },
            ],
          })),
        },
      ],
    }
    const result = importWorkflow(legacySpec)
    expect('error' in result).toBe(false)
    const data = (result as { nodes: Array<{ data: Record<string, unknown> }> }).nodes[0].data
    // P4.2: the legacy branch hydrates to a local var only, to feed the converter — it
    // is never persisted on nodeData (the v1 editor is retired).
    expect(data.formLayouts).toBeUndefined()
    const doc = data.formDocument as { sections: Array<{ role: string; rows: Array<{ blocks: unknown[] }> }> }
    expect(validateFormDocument(doc).ok).toBe(true)
    expect(doc.sections.some((s) => s.role === 'footer')).toBe(false) // pair dropped
    // Form labels won into uiParameters
    const yesNo = (data.uiParameters as Array<{ type: string; value: string; value2?: string }>).find(
      (p) => p.type === 'YesNoButtons',
    )
    expect(yesNo).toMatchObject({ value: 'Proceed', value2: 'Abort' })
  })
})
