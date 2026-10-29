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

// Builds a synthetic .WFenvirX (single-env package) for the smoke test.
// Produces /tmp/smoke.WFenvirX containing:
//   SmokeEnv.WFenvir              — env spec
//   actions/EchoSim.WFaction      — opaque action; code will be uploaded separately
//   actions/Inspector.WFaction    — opaque action; no code initially
//   manifest.json
//
// Identifiers chosen for the smoke run only — do not collide with prior dev envs.
import JSZip from 'jszip'
import { writeFileSync } from 'node:fs'

const ENV_OID = 'smoke-env-001'
const ECHO_OID = 'smoke-act-echo'
const INSPECTOR_OID = 'smoke-act-inspector'
const NOW = new Date().toISOString()

const env = {
  oid: ENV_OID,
  local_id: 'SmokeEnv',
  version: '1.0.0',
  last_modified_date: NOW,
  schemaVersion: '4.0',
  state: 'Effective',
  description: 'Layer 5 smoke test environment',
  action_property_specifications: [
    {
      name: 'SIM_MODE',
      oid: 'smoke-prop-sim-mode',
      description: 'Simulation mode toggle, mutable by EchoSim.execute()',
      entries: [{ name: 'Value', value: 'true' }],
    },
  ],
  value_property_specifications: [],
  resource_property_specifications: [],
  included_actions: [
    { action_name: 'EchoSim', oid: ECHO_OID },
    { action_name: 'Inspector', oid: INSPECTOR_OID },
  ],
}

const echoAction = {
  oid: ECHO_OID,
  local_id: 'EchoSim',
  version: '1.0.0',
  last_modified_date: NOW,
  action_visibility: 'opaque',
  state: 'Effective',
  description: 'Opaque action that flips SIM_MODE via set_property',
  input_parameter_specifications: [],
  output_parameter_specifications: [
    { name: 'echoed_sim_mode', data_type: 'string', default_value: '' },
  ],
  property_specifications: [],
}

const inspectorAction = {
  oid: INSPECTOR_OID,
  local_id: 'Inspector',
  version: '1.0.0',
  last_modified_date: NOW,
  action_visibility: 'opaque',
  state: 'Effective',
  description: 'No-op inspector action',
  input_parameter_specifications: [],
  output_parameter_specifications: [],
  property_specifications: [],
}

const manifest = {
  packageType: 'environment-package',
  formatVersion: 1,
  createdAt: NOW,
  environmentName: 'SmokeEnv',
  actionCount: 2,
}

const zip = new JSZip()
zip.file('SmokeEnv.WFenvir', JSON.stringify(env, null, 2))
zip.file('actions/EchoSim.WFaction', JSON.stringify(echoAction, null, 2))
zip.file('actions/Inspector.WFaction', JSON.stringify(inspectorAction, null, 2))
zip.file('manifest.json', JSON.stringify(manifest, null, 2))

const buf = await zip.generateAsync({ type: 'nodebuffer' })
const out = process.argv[2] ?? './smoke.WFenvirX'
writeFileSync(out, buf)
console.log(`wrote ${out} (${buf.length} bytes)`)
console.log(`  env_oid=${ENV_OID}  echo_oid=${ECHO_OID}  inspector_oid=${INSPECTOR_OID}`)
