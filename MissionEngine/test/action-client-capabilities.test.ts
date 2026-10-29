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
import { expect, test, vi } from 'vitest';
import { ActionClient } from '../src/actions/client.js';

const WIRE = {
  data: {
    environments: [{
      environment_oid: 'env-container-1', environment_name: 'Kitchen', environment_state: 'Effective',
      action_properties: [],
      actions: [{
        action_oid: 'act-container-1', action_name: 'PreheatOven', action_state: 'Effective',
        local_id: 'PreheatOven', version: '1.0.0', description: null, visibility: 'opaque',
        input_parameters: [{ name: 'oven_id' }, { name: 'target_temp_c' }],
        output_parameters: [], supported_commands: ['ABORT'],
      }],
    }],
  },
  meta: { total_environments: 1, total_actions: 1 },
};

function mkFetch(payload: unknown = WIRE) {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
}

test('parses the environment-grouped wire shape into byActionOid + environments', async () => {
  const client = new ActionClient(['http://stub'], mkFetch() as any);
  const caps = await client.capabilities('http://stub');
  expect(caps.byActionOid.get('act-container-1')).toEqual({ supportedCommands: ['ABORT'], opaque: true });
  const env = caps.environments[0]!;
  expect(env.environmentName).toBe('Kitchen');
  expect(env.actions[0]!.actionName).toBe('PreheatOven');
  expect(env.actions[0]!.inputParameterNames).toEqual(['oven_id', 'target_temp_c']);
});

test('caches per origin; invalidateCapabilities forces a refetch', async () => {
  const fetchImpl = mkFetch();
  const client = new ActionClient(['http://stub'], fetchImpl as any);
  await client.capabilities('http://stub');
  await client.capabilities('http://stub');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  client.invalidateCapabilities('http://stub');
  await client.capabilities('http://stub');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
