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
import { validateWorkflow, validateWorkflowWithChildren } from '../workflow-validation'
import type { WorkflowNode, TrySpec } from '@/types/nodes'
import type { Specification } from '@/types/library'
import type { Edge } from '@xyflow/react'

const N = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, stepType: type, ...data } }) as unknown as WorkflowNode
const E = (source: string, target: string): Edge => ({ id: `${source}-${target}`, source, target }) as Edge
const msgs = (n: WorkflowNode[], e: Edge[], wfTries: TrySpec[] = []) =>
  validateWorkflow(n, e, wfTries)
    .map((x) => x.message)
    .join(' | ')

describe('TRY/CATCH/RETURN validation', () => {
  it('flags a duplicate catch_id', () => {
    const nodes = [
      N('s1', 'start'),
      N('s2', 'end'),
      N('c1', 'catch', { catchId: 'C1' }),
      N('r1', 'return', { returnConfig: { command: 'ABANDON' } }),
      N('c2', 'catch', { catchId: 'C1' }),
      N('r2', 'return', { returnConfig: { command: 'ABANDON' } }),
    ]
    const edges = [E('s1', 's2'), E('c1', 'r1'), E('c2', 'r2')]
    expect(msgs(nodes, edges)).toMatch(/duplicate catch_id|catch_id .*C1/i)
  })
  it('flags an unmatched TRY (catch_id with no CATCH)', () => {
    const nodes = [
      N('s1', 'start'),
      N('s2', 'actionProxyWait', { trySpecifications: [{ mode: 'ERROR', catch_id: 'Ghost' }] }),
      N('s3', 'end'),
    ]
    expect(msgs(nodes, [E('s1', 's2'), E('s2', 's3')])).toMatch(/unmatched|no CATCH|Ghost|unknown catch_id/i)
  })
  it('flags a CATCH with no reachable RETURN', () => {
    const nodes = [
      N('s1', 'start'),
      N('s2', 'end'),
      N('c1', 'catch', { catchId: 'C1' }),
      N('u1', 'userInteractionStep'),
    ]
    expect(msgs(nodes, [E('s1', 's2'), E('c1', 'u1')])).toMatch(/RETURN/i)
  })
  it('flags a GOTO target inside a catch network', () => {
    const nodes = [
      N('s1', 'start'),
      N('s2', 'actionProxyWait', { trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      N('s3', 'end'),
      N('c1', 'catch', { catchId: 'C1' }),
      N('r1', 'return', { returnConfig: { command: 'GOTO', goto_step_oid: 'c1' } }),
    ]
    expect(msgs(nodes, [E('s1', 's2'), E('s2', 's3'), E('c1', 'r1')])).toMatch(/GOTO.*catch|goto/i)
  })
  it('flags TRY on a step type that cannot carry it (e.g. Parallel)', () => {
    // workflowProxy became TRY-capable 2026-08-22 (spec: escalated child failures route
    // through the proxy's own TRY rows) — use a genuinely non-TRY-capable type here instead.
    const nodes = [
      N('s1', 'start'),
      N('s2', 'parallel', { trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      N('s3', 'end'),
    ]
    expect(msgs(nodes, [E('s1', 's2'), E('s2', 's3')])).toMatch(/only allowed/i)
  })
  it.each(['scriptStep', 'userInteractionStep', 'yesNoStep'] as const)(
    'allows TRY on %s (no TRY-scope error)',
    (nt) => {
      const nodes = [
        N('s1', 'start'),
        N('s2', nt, { trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
        N('s3', 'end'),
        N('c1', 'catch', { catchId: 'C1' }),
        N('r1', 'return', { returnConfig: { command: 'ABANDON' } }),
      ]
      expect(msgs(nodes, [E('s1', 's2'), E('s2', 's3'), E('c1', 'r1')])).not.toMatch(/only allowed/i)
    },
  )
  it('flags a CATCH with no catch_id', () => {
    const nodes = [
      N('s1', 'start'),
      N('s2', 'end'),
      N('c1', 'catch'),
      N('r1', 'return', { returnConfig: { command: 'ABANDON' } }),
    ]
    expect(msgs(nodes, [E('s1', 's2'), E('c1', 'r1')])).toMatch(/CATCH has no catch_id|no catch_id/i)
  })
  it('passes a well-formed try/catch/return workflow (no TC errors)', () => {
    const nodes = [
      N('s1', 'start'),
      N('s2', 'actionProxyWait', { trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      N('s3', 'end'),
      N('c1', 'catch', { catchId: 'C1' }),
      N('r1', 'return', { returnConfig: { command: 'ABANDON' } }),
    ]
    const tc = validateWorkflow(nodes, [E('s1', 's2'), E('s2', 's3'), E('c1', 'r1')]).filter(
      (x) => x.nodeType === 'catch' || x.nodeType === 'return' || /TRY|CATCH|RETURN/i.test(x.message),
    )
    expect(tc).toEqual([])
  })
  it('flags a RESTART with no restart_mode', () => {
    const nodes = [
      N('s1', 'start'),
      N('s2', 'actionProxyWait', { trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      N('s3', 'end'),
      N('c1', 'catch', { catchId: 'C1' }),
      N('r1', 'return', { returnConfig: { command: 'RESTART' } }),
    ]
    expect(msgs(nodes, [E('s1', 's2'), E('s2', 's3'), E('c1', 'r1')])).toMatch(/restart mode|RESTART requires/i)
  })
  it('flags a GOTO with no target', () => {
    const nodes = [
      N('s1', 'start'),
      N('s2', 'actionProxyWait', { trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      N('s3', 'end'),
      N('c1', 'catch', { catchId: 'C1' }),
      N('r1', 'return', { returnConfig: { command: 'GOTO' } }),
    ]
    expect(msgs(nodes, [E('s1', 's2'), E('s2', 's3'), E('c1', 'r1')])).toMatch(/GOTO requires|target step/i)
  })
  it('flags a GOTO whose target step no longer exists (dangling reference)', () => {
    // The target step was deleted/recreated after the GOTO was wired, leaving goto_step_oid
    // pointing at a step that no longer exists. Exporting it would strand the workflow at
    // runtime (RUNNING, no active steps). The export must block it so the user re-selects.
    const nodes = [
      N('s1', 'start'),
      N('s2', 'actionProxyWait', { trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      N('s3', 'end'),
      N('c1', 'catch', { catchId: 'C1' }),
      N('r1', 'return', { returnConfig: { command: 'GOTO', goto_step_oid: 'deleted-step' } }),
    ]
    expect(msgs(nodes, [E('s1', 's2'), E('s2', 's3'), E('c1', 'r1')])).toMatch(/no longer exists|re-select|not found/i)
  })
  it('flags duplicate TRY modes on one step', () => {
    const nodes = [
      N('s1', 'start'),
      N('s2', 'actionProxyWait', {
        trySpecifications: [
          { mode: 'ERROR', catch_id: 'C1' },
          { mode: 'ERROR', catch_id: 'C1' },
        ],
      }),
      N('s3', 'end'),
      N('c1', 'catch', { catchId: 'C1' }),
      N('r1', 'return', { returnConfig: { command: 'ABANDON' } }),
    ]
    expect(msgs(nodes, [E('s1', 's2'), E('s2', 's3'), E('c1', 'r1')])).toMatch(/duplicate try mode/i)
  })
})

describe('Workflow-level TRY (spec 2026-08-22)', () => {
  it('flags a workflow-level TRY row referencing an unknown catch_id', () => {
    const nodes = [N('s1', 'start'), N('s2', 'end')]
    const edges = [E('s1', 's2')]
    const errors = validateWorkflow(nodes, edges, [{ mode: 'ERROR', catch_id: 'MISSING' }])
    const wfErrors = errors.filter((e) => e.nodeType === 'workflow')
    expect(wfErrors).toHaveLength(1)
    expect(wfErrors[0].message).toMatch(/Workflow TRY ON ERROR references unknown catch_id "MISSING"/)
  })

  it('flags a duplicate workflow-level TRY mode', () => {
    const nodes = [
      N('s1', 'start'),
      N('s2', 'end'),
      N('c1', 'catch', { catchId: 'C1' }),
      N('r1', 'return', { returnConfig: { command: 'ABANDON' } }),
    ]
    const edges = [E('s1', 's2'), E('c1', 'r1')]
    const errors = validateWorkflow(nodes, edges, [
      { mode: 'ERROR', catch_id: 'C1' },
      { mode: 'ERROR', catch_id: 'C1' },
    ])
    expect(errors.map((e) => e.message).join(' | ')).toMatch(/Duplicate workflow-level TRY mode "ERROR"/)
  })

  it('passes valid workflow-level TRY rows targeting an existing CATCH with a reachable RETURN', () => {
    const nodes = [
      N('s1', 'start'),
      N('s2', 'end'),
      N('c1', 'catch', { catchId: 'C1' }),
      N('r1', 'return', { returnConfig: { command: 'ABANDON' } }),
    ]
    const edges = [E('s1', 's2'), E('c1', 'r1')]
    const errors = validateWorkflow(nodes, edges, [{ mode: 'ERROR', catch_id: 'C1' }])
    expect(errors).toEqual([])
  })

  it('allows trySpecifications on a workflowProxy node (now TRY-capable)', () => {
    const nodes = [
      N('s1', 'start'),
      N('s2', 'workflowProxy', { trySpecifications: [{ mode: 'ERROR', catch_id: 'C1' }] }),
      N('s3', 'end'),
      N('c1', 'catch', { catchId: 'C1' }),
      N('r1', 'return', { returnConfig: { command: 'ABANDON' } }),
    ]
    const edges = [E('s1', 's2'), E('s2', 's3'), E('c1', 'r1')]
    expect(msgs(nodes, edges)).not.toMatch(/only allowed/i)
  })

  it('validateWorkflowWithChildren: flags a child workflow-level TRY row referencing a missing catch_id, tagged with the child workflow name', () => {
    const parentNodes = [N('p1', 'start'), N('p2', 'end')]
    const parentEdges = [E('p1', 'p2')]
    const parentSpec = {
      id: 'parent-1',
      libraryId: 'L1',
      name: 'Parent',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      history: [],
      createdAt: 0,
      updatedAt: 0,
      data: {},
    } as unknown as Specification
    const childSpec = {
      id: 'child-1',
      libraryId: 'L1',
      name: 'Child WF',
      description: null,
      version: '1.0.0',
      state: 'Draft',
      history: [],
      createdAt: 0,
      updatedAt: 0,
      data: {
        parentSpecificationId: 'parent-1',
        nodes: [N('c-s1', 'start'), N('c-s2', 'end')],
        edges: [E('c-s1', 'c-s2')],
        workflowTrySpecifications: [{ mode: 'ERROR', catch_id: 'MISSING' }],
      },
    } as unknown as Specification

    const errors = validateWorkflowWithChildren(parentNodes, parentEdges, 'parent-1', [parentSpec, childSpec])
    const wfErrors = errors.filter((e) => e.nodeType === 'workflow')
    expect(wfErrors).toHaveLength(1)
    expect(wfErrors[0].message).toMatch(/Workflow TRY ON ERROR references unknown catch_id "MISSING"/)
    expect(wfErrors[0].workflowName).toBe('Child WF')
  })
})
