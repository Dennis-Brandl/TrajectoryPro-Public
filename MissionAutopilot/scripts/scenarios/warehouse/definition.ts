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
    oid: 'lib-warehouse-001',
    local_id: 'WarehouseLibrary',
    version: '1.0.0',
  },
  environment: {
    oid: 'env-warehouse-001',
    local_id: 'AutomatedWarehouse',
    version: '1.0.0',
    schemaVersion: '4.0',
    description:
      'Automated warehouse simulation with 10 actions and SIMULATION_MODE failure injection.',
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
    {
      oid: 'act-wh-pick-001',
      local_id: 'PickItem',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Retrieve an item from a warehouse shelf location',
      inputs: [
        { id: 'shelf_location', value_type: 'literal', default_value: 'BIN-A1' },
        { id: 'item_sku', value_type: 'literal', default_value: 'SKU-1001' },
        { id: 'quantity', value_type: 'literal', default_value: '1' },
      ],
      outputs: [
        { id: 'picked_quantity', value_type: 'literal', default_value: '0' },
        { id: 'pick_status', value_type: 'literal', default_value: '' },
        STATUS_OUTPUT,
      ],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-putaway-001',
      local_id: 'PutawayItem',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Place an item onto a shelf location',
      inputs: [
        { id: 'shelf_location', value_type: 'literal', default_value: 'BIN-B2' },
        { id: 'item_sku', value_type: 'literal', default_value: 'SKU-2001' },
        { id: 'quantity', value_type: 'literal', default_value: '1' },
      ],
      outputs: [
        { id: 'stored_quantity', value_type: 'literal', default_value: '0' },
        STATUS_OUTPUT,
      ],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-move-001',
      local_id: 'MoveItem',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Move an item between two shelf locations',
      inputs: [
        { id: 'from_location', value_type: 'literal', default_value: 'BIN-A1' },
        { id: 'to_location', value_type: 'literal', default_value: 'BIN-A2' },
        { id: 'item_sku', value_type: 'literal', default_value: 'SKU-1001' },
      ],
      outputs: [STATUS_OUTPUT],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-consolidate-001',
      local_id: 'ConsolidateOrder',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Consolidate items into a customer order pallet',
      inputs: [
        { id: 'order_id', value_type: 'literal', default_value: 'ORD-9001' },
        { id: 'item_count', value_type: 'literal', default_value: '5' },
      ],
      outputs: [{ id: 'pallet_id', value_type: 'literal', default_value: '' }, STATUS_OUTPUT],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-cyclecount-001',
      local_id: 'CycleCount',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Cycle-count items in a zone',
      inputs: [{ id: 'zone', value_type: 'literal', default_value: 'A' }],
      outputs: [
        { id: 'discrepancy_count', value_type: 'literal', default_value: '0' },
        STATUS_OUTPUT,
      ],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-receive-001',
      local_id: 'ReceiveShipment',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Receive an inbound shipment',
      inputs: [
        { id: 'shipment_id', value_type: 'literal', default_value: 'SHP-1001' },
        { id: 'expected_count', value_type: 'literal', default_value: '50' },
      ],
      outputs: [{ id: 'received_count', value_type: 'literal', default_value: '0' }, STATUS_OUTPUT],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-ship-001',
      local_id: 'ShipOrder',
      version: '1.0.0',
      visibility: 'observable',
      description: 'Ship a consolidated order',
      inputs: [
        { id: 'order_id', value_type: 'literal', default_value: 'ORD-9001' },
        { id: 'carrier', value_type: 'literal', default_value: 'GROUND' },
      ],
      outputs: [{ id: 'tracking_number', value_type: 'literal', default_value: '' }, STATUS_OUTPUT],
      code_states: OBSERVABLE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-updateinv-001',
      local_id: 'UpdateInventoryDB',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Background DB update for inventory deltas',
      inputs: [
        { id: 'sku', value_type: 'literal', default_value: 'SKU-1001' },
        { id: 'delta', value_type: 'literal', default_value: '1' },
      ],
      outputs: [STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-scan-001',
      local_id: 'ScanBarcode',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Scan a barcode and resolve to SKU',
      inputs: [{ id: 'barcode', value_type: 'literal', default_value: '0123456789012' }],
      outputs: [{ id: 'sku', value_type: 'literal', default_value: '' }, STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
    {
      oid: 'act-wh-print-001',
      local_id: 'PrintLabel',
      version: '1.0.0',
      visibility: 'opaque',
      description: 'Print a shipping or shelf label',
      inputs: [
        { id: 'label_type', value_type: 'literal', default_value: 'shelf' },
        { id: 'content', value_type: 'literal', default_value: 'BIN-A1' },
      ],
      outputs: [STATUS_OUTPUT],
      code_states: OPAQUE_STATES,
      timeout_seconds: 3,
    },
  ],
}
