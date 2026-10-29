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
import { httpActionInvoker } from '../src/actions/invoker.js';

const CAPS = (over: Partial<{ envName: string; actName: string; inputs: string[] }> = {}) => ({
  data: { environments: [{
    environment_oid: 'env-c', environment_name: over.envName ?? 'Kitchen',
    actions: [{
      action_oid: 'act-c', action_name: over.actName ?? 'PreheatOven', visibility: 'opaque',
      input_parameters: (over.inputs ?? ['oven_id', 'target_temp_c']).map((name) => ({ name })),
      output_parameters: [], supported_commands: ['ABORT'],
    }],
  }] },
});

function harness(capsPayloads: unknown[]) {
  const calls: string[] = [];
  let capsIdx = 0;
  const fetchImpl = vi.fn(async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/capabilities')) {
      return new Response(JSON.stringify(capsPayloads[Math.min(capsIdx++, capsPayloads.length - 1)]), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { instance_id: 'i1' } }), { status: 201 });
  });
  const client = new ActionClient(['http://stub'], fetchImpl as any);
  const invoker = httpActionInvoker(client, async () => 'http://stub');
  return { calls, invoker };
}

const CTX = {
  workCenterId: 'wc', environmentOid: 'env-w', actionOid: 'act-w',
  workflowInstanceId: 'wi', stepInstanceId: 'si', stepOid: 'so',
  inputParameters: [{ name: 'oven_id', value: 'A' }],
  matching: 'loose' as const, environmentName: 'Kitchen', actionName: 'PreheatOven',
};

test('loose: resolves by name and invokes with the CONTAINER oids', async () => {
  const { calls, invoker } = harness([CAPS()]);
  const res = await invoker.begin({ ...CTX });
  expect(res).toMatchObject({ ok: true, invokedActionOid: 'act-c' });
  const invokeCall = calls.find((c) => c.includes('/invoke'))!;
  expect(invokeCall).toContain('/actions/act-c/invoke');
});

test('loose: missing action -> F3, after a cache-bust retry (capabilities fetched twice)', async () => {
  const { calls, invoker } = harness([CAPS({ actName: 'Other' }), CAPS({ actName: 'Other' })]);
  const res = await invoker.begin({ ...CTX });
  expect(res).toMatchObject({ ok: false, error: 'loose match: environment "Kitchen" has no action named "PreheatOven". Check this environment\'s binding in this work center.' });
  expect(calls.filter((c) => c.includes('/capabilities')).length).toBe(2);
});

test('loose: cache-bust retry succeeds when the second fetch resolves', async () => {
  const { invoker } = harness([CAPS({ actName: 'Other' }), CAPS()]);
  const res = await invoker.begin({ ...CTX });
  expect(res).toMatchObject({ ok: true, invokedActionOid: 'act-c' });
});

test('loose: missing input parameter names -> F5 listing them', async () => {
  const { invoker } = harness([CAPS({ inputs: ['oven_id'] })]);
  const res = await invoker.begin({ ...CTX, inputParameters: [{ name: 'oven_id', value: 'A' }, { name: 'target_temp_c', value: '2' }, { name: 'mode', value: 'x' }] });
  expect(res).toMatchObject({ ok: false, error: 'loose match: action "PreheatOven" is missing input parameter(s): target_temp_c, mode' });
});

test('loose: no environment named X -> F1; ambiguous env -> F2; ambiguous action -> F4', async () => {
  const none = await harness([CAPS({ envName: 'Bakery' })]).invoker.begin({ ...CTX });
  expect(none).toMatchObject({ ok: false, error: 'loose match: no environment named "Kitchen" on the action server. Check this environment\'s binding in this work center.' });
  const dupEnvPayload = { data: { environments: [CAPS().data.environments[0], CAPS().data.environments[0]] } };
  const dupEnv = await harness([dupEnvPayload]).invoker.begin({ ...CTX });
  expect(dupEnv).toMatchObject({ ok: false, error: 'loose match: multiple environments named "Kitchen" on the action server — ambiguous' });
  const base = CAPS().data.environments[0]!;
  const dupActPayload = { data: { environments: [{ ...base, actions: [base.actions[0], base.actions[0]] }] } };
  const dupAct = await harness([dupActPayload]).invoker.begin({ ...CTX });
  expect(dupAct).toMatchObject({ ok: false, error: 'loose match: environment "Kitchen" has multiple actions named "PreheatOven" — ambiguous' });
});

test('strict: invokes with the WORKFLOW oid and never fetches capabilities', async () => {
  const { calls, invoker } = harness([CAPS()]);
  const res = await invoker.begin({ ...CTX, matching: 'strict', environmentName: null, actionName: null });
  expect(res).toMatchObject({ ok: true, invokedActionOid: 'act-w' });
  expect(calls.some((c) => c.includes('/capabilities'))).toBe(false);
  expect(calls.find((c) => c.includes('/invoke'))).toContain('/actions/act-w/invoke');
});

test('loose: with declaredInputNames, only the step\'s declared inputs are required (extras are still sent)', async () => {
  const sent = [{ name: 'oven_id', value: 'A' }, { name: 'OrderNumber', value: '7' }];
  const ok = await harness([CAPS({ inputs: ['oven_id'] })]).invoker.begin({ ...CTX, inputParameters: sent, declaredInputNames: ['oven_id'] });
  expect(ok).toMatchObject({ ok: true, invokedActionOid: 'act-c' });
  const miss = await harness([CAPS({ inputs: ['oven_id'] })]).invoker.begin({ ...CTX, inputParameters: sent, declaredInputNames: ['oven_id', 'target_temp_c'] });
  expect(miss).toMatchObject({ ok: false, error: 'loose match: action "PreheatOven" is missing input parameter(s): target_temp_c' });
});
