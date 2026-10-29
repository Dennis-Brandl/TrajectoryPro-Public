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
import type { FormDocument } from '@mission/form-schema'
import { COMPLETE, MockEngine, type FlowGraph } from '../MockEngine'

const doc = (id: string): FormDocument => ({
  version: 2,
  sections: [{ id: `${id}-s`, role: 'content', rows: [] }],
})

const graph: FlowGraph = {
  entry: 'a',
  nodes: {
    a: { screenId: 'a', document: doc('a'), transitions: { go: 'b' } },
    b: { screenId: 'b', document: doc('b'), transitions: { yes: 'c', no: COMPLETE } },
    c: { screenId: 'c', document: doc('c'), transitions: { done: COMPLETE, again: 'c' } },
  },
}

const press = (outputValue: string) => ({ blockId: 'x', outputValue })

describe('MockEngine', () => {
  it('start() returns the entry screen with an instance id and empty values', () => {
    const t = new MockEngine(graph).start()
    expect(t).toEqual({
      kind: 'screen',
      screenId: 'a',
      instanceId: 'a#1',
      document: doc('a'),
      values: {},
    })
  })

  it('next() routes by the pressed button outputValue and carries values forward', () => {
    const e = new MockEngine(graph)
    e.start()
    e.next({ serial: 'SN-1' }, press('go')) // a -> b
    expect(e.next({ serial: 'SN-1' }, press('yes'))).toEqual({
      kind: 'screen',
      screenId: 'c',
      instanceId: 'c#3',
      document: doc('c'),
      values: { serial: 'SN-1' },
    })
  })

  it('next() returns complete for a COMPLETE transition', () => {
    const e = new MockEngine(graph)
    e.start()
    e.next({}, press('go')) // a -> b
    expect(e.next({}, press('no'))).toEqual({ kind: 'complete' })
  })

  it('next() throws on an unknown outputValue', () => {
    const e = new MockEngine(graph)
    e.start()
    expect(() => e.next({}, press('nope'))).toThrow(/no transition/)
  })

  it('next() throws before start()', () => {
    expect(() => new MockEngine(graph).next({}, press('go'))).toThrow(/call start\(\) first/)
  })

  it('mints a distinct instance id on every entry, including a self-loop', () => {
    // The defect this exists to prevent: a step looping to ITSELF keeps the same
    // screenId, so only a fresh instanceId makes the host remount and restart the
    // step's timers. See docs/HOST-CONTRACT.md §3-§4.
    const e = new MockEngine(graph)
    e.start()
    e.next({}, press('go')) // a -> b
    const first = e.next({}, press('yes')) as { screenId: string; instanceId: string }
    const looped = e.next({}, press('again')) as { screenId: string; instanceId: string } // c -> c
    expect(looped.screenId).toBe(first.screenId)
    expect(looped.instanceId).not.toBe(first.instanceId)
  })

  it('back() re-enters the previous step as a new instance, restoring its values', () => {
    const e = new MockEngine(graph)
    const entry = e.start() as { instanceId: string }
    e.next({ serial: 'SN-1' }, press('go')) // leave a with SN-1
    e.next({ serial: 'SN-2' }, press('yes')) // leave b with SN-2
    expect(e.back()).toEqual({
      kind: 'screen',
      screenId: 'b',
      instanceId: 'b#4',
      document: doc('b'),
      values: { serial: 'SN-2' }, // values as of leaving b
    })
    const backToA = e.back()!
    expect(backToA.screenId).toBe('a')
    expect(backToA.values).toEqual({ serial: 'SN-1' }) // as of leaving a, not SN-2
    expect(backToA.instanceId).not.toBe(entry.instanceId) // re-entry is a new instance
  })

  it('canGoBack() is false at the entry step and true once advanced', () => {
    const e = new MockEngine(graph)
    e.start()
    expect(e.canGoBack()).toBe(false)
    expect(e.back()).toBeNull()
    e.next({}, press('go'))
    expect(e.canGoBack()).toBe(true)
  })

  it('back() steps back off completion onto the last step', () => {
    const e = new MockEngine(graph)
    e.start()
    e.next({}, press('go')) // a -> b
    expect(e.next({}, press('no'))).toEqual({ kind: 'complete' })
    expect(e.canGoBack()).toBe(true)
    const t = e.back()!
    expect(t.screenId).toBe('b') // not 'a' — completion is not a step on the stack
  })

  it('step() counts entries, so a self-loop advances it', () => {
    const e = new MockEngine(graph)
    e.start()
    expect(e.step()).toBe(1)
    e.next({}, press('go'))
    e.next({}, press('yes'))
    expect(e.step()).toBe(3)
    e.next({}, press('again')) // c -> c
    expect(e.step()).toBe(4)
    e.back()
    expect(e.step()).toBe(3)
  })

  it('start() resets position', () => {
    const e = new MockEngine(graph)
    e.start()
    e.next({ serial: 'SN-1' }, press('go'))
    const t = e.start()
    expect(t).toMatchObject({ screenId: 'a', values: {} })
    expect(e.step()).toBe(1)
    expect(e.canGoBack()).toBe(false)
  })

  it('constructor throws on a dangling transition target', () => {
    const bad: FlowGraph = {
      entry: 'a',
      nodes: { a: { screenId: 'a', document: doc('a'), transitions: { go: 'missing' } } },
    }
    expect(() => new MockEngine(bad)).toThrow(/unknown screen "missing"/)
  })

  it('constructor throws when the entry is not a node', () => {
    const bad: FlowGraph = { entry: 'ghost', nodes: {} }
    expect(() => new MockEngine(bad)).toThrow(/entry "ghost"/)
  })
})
