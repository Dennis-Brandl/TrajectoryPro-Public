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

import { afterEach, expect, test, vi } from 'vitest';
import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { workCenter, workflow, workflowInstance, stepInstance, brokerActionInstance } from 'mission-control-db/src/db/schema/index';
import * as store from '../src/store.js';
import { makeTestDb } from './helpers/db.js';
import { createApp } from '../src/app.js';
import { EventHub } from '../src/events.js';
import { BROKER_ENV } from '../src/catalog.js';

const TOKEN = 't'.repeat(40);
const AUTH = { authorization: `Bearer ${TOKEN}` };

let cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of cleanup.reverse()) await f(); cleanup = []; });

async function setup(actionName = 'Get Runtime Workflow Status') {
  const { db, close } = await makeTestDb(); cleanup.push(close);
  const spec = { oid: 'root', steps: [{ oid: 'act', step_type: 'ACTION PROXY', action_proxy_config: { action_name: actionName } }] };
  const [wc] = await db.insert(workCenter).values({ name: 'Line A', nextRuntimeNumber: 2 }).returning();
  const [wf] = await db.insert(workflow).values({ oid: 'root', name: 'Caller', workCenterId: wc.id, specJsonb: spec }).returning();
  await db.insert(workflow).values({ oid: 'child', name: 'Child', workCenterId: wc.id, state: 'Effective', specJsonb: { oid: 'child', steps: [], connections: [] } });
  const [ci] = await db.insert(workflowInstance).values({
    workflowId: wf.id, workCenterId: wc.id, triggeredBy: 'manual', status: 'running', specJsonb: spec,
    runtimeNumber: 1, runtimeLabel: 'RW-1', masterName: 'Caller', masterOid: 'root', masterVersion: '1.0.0', masterState: 'Draft',
  }).returning();
  const [si] = await db.insert(stepInstance).values({ workflowInstanceId: ci.id, nodeOid: 'root', stepOid: 'act', stepType: 'ACTION PROXY', state: 'WAITING_ACTION', startedAt: new Date() }).returning();
  const hub = new EventHub();
  const app = createApp({ db, hub, now: () => new Date(), pingMs: 25, token: TOKEN, corsOrigins: [] });
  const body = (extra: Record<string, unknown> = {}) => JSON.stringify({
    environment_oid: BROKER_ENV.oid, workflow_instance_id: ci.id, step_instance_id: si.id, step_oid: 'act',
    input_parameters: [{ name: 'RuntimeWorkflow', value: ci.id }], ...extra,
  });
  // A real waiting step of the same runtime whose configured action is an ordinary (non-broker) action.
  await db.update(workflowInstance).set({ specJsonb: { ...spec, steps: [...spec.steps,
    { oid: 'other-act', step_type: 'ACTION PROXY', action_proxy_config: { action_name: 'Mix Paint', action_oid: 'autopilot-mix' } }] } })
    .where(eq(workflowInstance.id, ci.id));
  const [otherStep] = await db.insert(stepInstance).values({ workflowInstanceId: ci.id, nodeOid: 'root', stepOid: 'other-act', stepType: 'ACTION PROXY', state: 'WAITING_ACTION', startedAt: new Date() }).returning();
  return { app, db, hub, ci, si, body, otherStep };
}

test('capabilities advertise the environment and ten opaque actions', async () => {
  const { app } = await setup();
  const res = await app.request('/trajectory/v1/capabilities', { headers: AUTH });
  const json = await res.json() as { data: { environments: Array<{ environment_name: string; actions: Array<{ visibility: string; input_parameters: unknown[] }> }> } };
  expect(json.data.environments[0].environment_name).toBe('Distributed Workflow Management');
  expect(json.data.environments[0].actions).toHaveLength(10);
  expect(json.data.environments[0].actions.every((a) => a.visibility === 'opaque')).toBe(true);
});

test('invoke by Designer oid resolves through the calling step; GET returns the engine shape', async () => {
  const { app, body } = await setup();
  const inv = await app.request('/trajectory/v1/actions/some-designer-uuid/invoke', { method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: body() });
  expect(inv.status).toBe(201);
  const { data } = await inv.json() as { data: { instance_id: string } };
  const got = await (await app.request(`/trajectory/v1/instances/${data.instance_id}`, { headers: AUTH })).json() as { data: { state: string; outputs: Array<{ name: string; value: string }> } };
  expect(got.data.state).toBe('COMPLETED');
  expect(got.data.outputs.find((o) => o.name === 'Runtime')!.value).toBe(JSON.stringify([{ name: 'State', value: 'Running' }]));
  expect((await app.request(`/trajectory/v1/instances/${data.instance_id}`, { method: 'DELETE', headers: AUTH })).status).toBe(200);
  expect((await app.request(`/trajectory/v1/instances/${data.instance_id}`, { headers: AUTH })).status).toBe(404);
});

test('a forged invoke is 403; a malformed one is 400', async () => {
  const { app, body, otherStep } = await setup();
  const forged = await app.request('/trajectory/v1/actions/broker-status/invoke', { method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: body({ step_oid: 'other' }) });
  expect(forged.status).toBe(403);
  // A genuinely waiting step that is calling a different (Autopilot) action cannot be replayed here.
  const replayed = await app.request('/trajectory/v1/actions/broker-status/invoke', { method: 'POST', headers: { 'content-type': 'application/json', ...AUTH },
    body: body({ step_instance_id: otherStep.id, step_oid: 'other-act' }) });
  expect(replayed.status).toBe(403);
  const bad = await app.request('/trajectory/v1/actions/broker-status/invoke', { method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: '{}' });
  expect(bad.status).toBe(400);
});

test('SSE on an already completed instance sends the terminal state_change at once', async () => {
  const { app, body } = await setup();
  const server = serve({ fetch: app.fetch, port: 0 });
  if (!server.listening) await new Promise<void>((r) => server.once('listening', () => r()));
  cleanup.push(() => new Promise<void>((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const inv = await fetch(`${base}/trajectory/v1/actions/broker-status/invoke`, { method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: body() });
  const { data } = await inv.json() as { data: { instance_id: string } };
  const ctl = new AbortController();
  const res = await fetch(`${base}/trajectory/v1/instances/${data.instance_id}/events`, { headers: { accept: 'text/event-stream', ...AUTH }, signal: ctl.signal });
  const reader = res.body!.getReader();
  let text = '';
  while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
  ctl.abort();
  expect(text).toContain('event: state_change');
  expect(text).toContain('"state":"COMPLETED"');
});

test('an open SSE stream sends comment pings; a disconnecting client leaves no subscriber', async () => {
  const { app, hub, body } = await setup();
  const server = serve({ fetch: app.fetch, port: 0 });
  if (!server.listening) await new Promise<void>((r) => server.once('listening', () => r()));
  cleanup.push(() => new Promise<void>((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const inv = await fetch(`${base}/trajectory/v1/actions/broker-status/invoke`, { method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: body() });
  const { data } = await inv.json() as { data: { instance_id: string } };
  const ctl = new AbortController();
  const res = await fetch(`${base}/trajectory/v1/instances/${data.instance_id}/events`, { headers: { accept: 'text/event-stream', ...AUTH }, signal: ctl.signal });
  const reader = res.body!.getReader();
  let text = '';
  while (!text.includes(': ping')) text += new TextDecoder().decode((await reader.read()).value);
  expect(hub.subscriberCount(data.instance_id)).toBe(1);
  ctl.abort();
  for (let i = 0; i < 100 && hub.subscriberCount(data.instance_id) > 0; i++) await new Promise((r) => setTimeout(r, 20));
  expect(hub.subscriberCount(data.instance_id)).toBe(0);
});

test('command ABORT on a completed instance is 409', async () => {
  const { app, body } = await setup();
  const inv = await app.request('/trajectory/v1/actions/broker-status/invoke', { method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: body() });
  const { data } = await inv.json() as { data: { instance_id: string } };
  const cmd = await app.request(`/trajectory/v1/instances/${data.instance_id}/command`, { method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: JSON.stringify({ command: 'ABORT' }) });
  expect(cmd.status).toBe(409);
});

const JSON_AUTH = { 'content-type': 'application/json', ...AUTH };
const CREATE_PARAMS = [{ name: 'Workflow', value: 'Child' }];

test('a repeated invoke for the same activation returns the same instance and runs execute once', async () => {
  const { app, db, ci, body } = await setup('Create Runtime Workflow');
  const post = () => app.request('/trajectory/v1/actions/broker-create/invoke', { method: 'POST', headers: JSON_AUTH, body: body({ input_parameters: CREATE_PARAMS }) });
  const first = await post();
  const second = await post();
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  const a = (await first.json() as { data: { instance_id: string } }).data.instance_id;
  const b = (await second.json() as { data: { instance_id: string } }).data.instance_id;
  expect(b).toBe(a);
  expect(await db.select().from(brokerActionInstance)).toHaveLength(1);
  expect(await db.select().from(workflowInstance).where(eq(workflowInstance.createdByInstanceId, ci.id))).toHaveLength(1);
});

test("an invoke that loses the insert race returns the winner's instance", async () => {
  const { app, db, ci, si, body } = await setup('Create Runtime Workflow');
  const [winner] = await db.insert(brokerActionInstance).values({
    actionKey: 'create', workflowInstanceId: ci.id, stepInstanceId: si.id, stepStartedAt: si.startedAt, state: 'COMPLETED', outputs: [],
  }).returning();
  const res = await app.request('/trajectory/v1/actions/broker-create/invoke', { method: 'POST', headers: JSON_AUTH, body: body({ input_parameters: CREATE_PARAMS }) });
  expect(res.status).toBe(201);
  expect((await res.json() as { data: { instance_id: string } }).data.instance_id).toBe(winner.id);
  // execute never ran: no child runtime was created.
  expect(await db.select().from(workflowInstance).where(eq(workflowInstance.createdByInstanceId, ci.id))).toHaveLength(0);
  expect(await db.select().from(brokerActionInstance)).toHaveLength(1);
});

async function storedRow(db: Awaited<ReturnType<typeof setup>>['db'], ci: { id: string }, si: { id: string }, state: 'RUNNING' | 'COMPLETED') {
  const [row] = await db.insert(brokerActionInstance).values({
    actionKey: 'wait', workflowInstanceId: ci.id, stepInstanceId: si.id, targetInstanceId: ci.id, state, outputs: [],
  }).returning();
  return row;
}

test('ABORT on a row finished by a wake is 409 and publishes nothing', async () => {
  const { app, db, hub, ci, si } = await setup();
  const row = await storedRow(db, ci, si, 'COMPLETED');
  // The route reads the row while it is still RUNNING; a wake finishes it before the ABORT update.
  vi.spyOn(store, 'getInstance').mockResolvedValue({ ...row, state: 'RUNNING' });
  const publish = vi.spyOn(hub, 'publish');
  const res = await app.request(`/trajectory/v1/instances/${row.id}/command`, { method: 'POST', headers: JSON_AUTH, body: JSON.stringify({ command: 'ABORT' }) });
  expect(res.status).toBe(409);
  expect((await res.json() as { error: { code: string } }).error.code).toBe('INVALID_STATE_TRANSITION');
  expect(publish).not.toHaveBeenCalled();
  const [after] = await db.select().from(brokerActionInstance).where(eq(brokerActionInstance.id, row.id));
  expect(after.state).toBe('COMPLETED');
});

test('ABORT with a null, array or invalid-JSON body is never 500', async () => {
  const { app, db, ci, si } = await setup();
  const row = await storedRow(db, ci, si, 'RUNNING');
  for (const b of ['null', '[]', 'not json']) {
    const res = await app.request(`/trajectory/v1/instances/${row.id}/command`, { method: 'POST', headers: JSON_AUTH, body: b });
    expect(res.status, b).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  }
  const [after] = await db.select().from(brokerActionInstance).where(eq(brokerActionInstance.id, row.id));
  expect(after.state).toBe('RUNNING');
});

test('ABORT with a non-string command is 400', async () => {
  const { app, db, ci, si } = await setup();
  const row = await storedRow(db, ci, si, 'RUNNING');
  const res = await app.request(`/trajectory/v1/instances/${row.id}/command`, { method: 'POST', headers: JSON_AUTH, body: JSON.stringify({ command: 42 }) });
  expect(res.status).toBe(400);
  expect((await res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
});

test('ABORT on a running row aborts it and publishes once', async () => {
  const { app, db, hub, ci, si } = await setup();
  const row = await storedRow(db, ci, si, 'RUNNING');
  const publish = vi.spyOn(hub, 'publish');
  const res = await app.request(`/trajectory/v1/instances/${row.id}/command`, { method: 'POST', headers: JSON_AUTH, body: JSON.stringify({ command: 'ABORT' }) });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ data: { accepted: true, new_state: 'ABORTED' } });
  expect(publish).toHaveBeenCalledTimes(1);
});
