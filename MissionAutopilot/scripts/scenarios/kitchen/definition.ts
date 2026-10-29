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

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScenarioDefinition } from '../lib/types.js'
import { STATUS_OUTPUT, OBSERVABLE_STATES, OPAQUE_STATES } from '../lib/conventions.js'

const rootDir = dirname(fileURLToPath(import.meta.url))

export const scenario: ScenarioDefinition = {
  rootDir,
  library: {
    oid: 'lib-kitchen-001',
    local_id: 'KitchenLibrary',
    version: '1.0.0',
  },
  environment: {
    oid: 'env-kitchen-001',
    local_id: 'IndustrialKitchen',
    version: '1.0.0',
    schemaVersion: '4.0',
    description:
      'Industrial kitchen simulation: single-order lifecycle from ticket-arrival through service. 10 actions (4 observable + 6 opaque) with SIMULATION_MODE failure injection.',
    action_property_specifications: [
      {
        name: 'SIMULATION_MODE',
        entries: [
          { name: 'Value', value: 'false' },
          {
            name: 'Description',
            value: 'When "true", actions inject random failures (~10% per execution)',
          },
        ],
      },
    ],
    value_property_specifications: [],
    resource_property_specifications: [],
  },
  actions: [
    // ────────────── Observable (4) ──────────────
    {
      oid: 'act-kt-sear-001',
      local_id: 'SearProtein',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Sear a protein on the flat top to a target internal temperature',
      inputs: [
        { id: 'protein', value_type: 'literal', default_value: 'ribeye' },
        { id: 'side', value_type: 'literal', default_value: 'first' },
        { id: 'target_internal_c', value_type: 'literal', default_value: '54' },
      ],
      outputs: [
        { id: 'internal_temp_c', value_type: 'literal', default_value: '0' },
        { id: 'sear_score', value_type: 'literal', default_value: '' },
        STATUS_OUTPUT,
      ],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-saute-001',
      local_id: 'SauteSides',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Sauté a vegetable side at a controlled heat level',
      inputs: [
        { id: 'pan_id', value_type: 'literal', default_value: 'PAN-3' },
        { id: 'vegetable', value_type: 'literal', default_value: 'asparagus' },
        { id: 'heat_level', value_type: 'literal', default_value: 'medium-high' },
      ],
      outputs: [{ id: 'doneness', value_type: 'literal', default_value: '' }, STATUS_OUTPUT],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-simmer-001',
      local_id: 'SimmerSauce',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Reduce a sauce base to a target reduction percentage',
      inputs: [
        { id: 'pot_id', value_type: 'literal', default_value: 'POT-2' },
        { id: 'sauce_base', value_type: 'literal', default_value: 'jus' },
        { id: 'reduction_target_pct', value_type: 'literal', default_value: '40' },
      ],
      outputs: [
        { id: 'final_reduction_pct', value_type: 'literal', default_value: '0' },
        STATUS_OUTPUT,
      ],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-plate-001',
      local_id: 'PlateOrder',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Compose the plate from cooked components',
      inputs: [
        { id: 'order_id', value_type: 'literal', default_value: 'ORD-7001' },
        { id: 'plate_id', value_type: 'literal', default_value: 'PLT-1' },
        { id: 'components', value_type: 'literal', default_value: 'protein+sides+sauce' },
      ],
      outputs: [{ id: 'plated_at', value_type: 'literal', default_value: '' }, STATUS_OUTPUT],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    // ────────────── Opaque (6) ──────────────
    {
      oid: 'act-kt-ticket-001',
      local_id: 'PrintKitchenTicket',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Print the kitchen ticket for an incoming order',
      inputs: [
        { id: 'ticket_id', value_type: 'literal', default_value: 'TKT-7001' },
        { id: 'order_summary', value_type: 'literal', default_value: 'pasta-special-1x' },
      ],
      outputs: [STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-prep-001',
      local_id: 'PrepStation',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Mise en place — portion and prep an ingredient',
      inputs: [
        { id: 'ingredient', value_type: 'literal', default_value: 'shallots' },
        { id: 'quantity_grams', value_type: 'literal', default_value: '120' },
        { id: 'cut_style', value_type: 'literal', default_value: 'brunoise' },
      ],
      outputs: [
        { id: 'portions_ready', value_type: 'literal', default_value: '0' },
        { id: 'prep_notes', value_type: 'literal', default_value: '' },
        STATUS_OUTPUT,
      ],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-preheat-001',
      local_id: 'PreheatGrill',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Set the grill to a target temperature',
      inputs: [
        { id: 'grill_id', value_type: 'literal', default_value: 'GRILL-1' },
        { id: 'target_temp_c', value_type: 'literal', default_value: '200' },
      ],
      outputs: [STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-garnish-001',
      local_id: 'GarnishPlate',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Apply garnish to a plated order',
      inputs: [
        { id: 'plate_id', value_type: 'literal', default_value: 'PLT-1' },
        { id: 'garnish', value_type: 'literal', default_value: 'chive' },
      ],
      outputs: [STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-expo-001',
      local_id: 'ExpoCheck',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Expediter inspection of a plated order',
      inputs: [{ id: 'ticket_id', value_type: 'literal', default_value: 'TKT-7001' }],
      outputs: [{ id: 'verdict', value_type: 'literal', default_value: '' }, STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-kt-log-001',
      local_id: 'LogService',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Record service completion in the kitchen audit log',
      inputs: [
        { id: 'order_id', value_type: 'literal', default_value: 'ORD-7001' },
        { id: 'table_id', value_type: 'literal', default_value: 'TBL-12' },
      ],
      outputs: [STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
  ],
}
