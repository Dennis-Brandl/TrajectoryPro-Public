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
import type { FormDocument, FormValues } from '@mission/form-schema'
import type { ActionEvent, FormEngine, ScreenTransition, Transition } from './FormEngine'

/** Sentinel `transitions` target meaning "the flow ends here". */
export const COMPLETE = '__complete__'

export interface FlowNode {
  screenId: string
  document: FormDocument
  /** Pressed button outputValue -> next screenId, or the COMPLETE sentinel. */
  transitions: Record<string, string>
}

export interface FlowGraph {
  entry: string
  nodes: Record<string, FlowNode>
}

/** One entered step: where it was, and the values as of leaving it. */
interface Frame {
  screenId: string
  values: FormValues
}

export class MockEngine implements FormEngine {
  /** Entered steps, oldest first; the last is the current step. */
  private stack: Frame[] = []
  /** True once the flow has run off the end; `back()` steps back onto the last step. */
  private completed = false
  /** Monotonic and never reset, so every entry gets an id no other entry has used. */
  private seq = 0

  constructor(private readonly graph: FlowGraph) {
    const { entry, nodes } = graph
    if (!nodes[entry]) {
      throw new Error(`MockEngine: entry "${entry}" is not a node`)
    }
    for (const node of Object.values(nodes)) {
      for (const [outputValue, target] of Object.entries(node.transitions)) {
        if (target !== COMPLETE && !nodes[target]) {
          throw new Error(
            `MockEngine: transition "${outputValue}" from "${node.screenId}" targets unknown screen "${target}"`,
          )
        }
      }
    }
  }

  private mint(frame: Frame): ScreenTransition {
    this.seq += 1
    return {
      kind: 'screen',
      screenId: frame.screenId,
      instanceId: `${frame.screenId}#${this.seq}`,
      document: this.graph.nodes[frame.screenId]!.document,
      values: frame.values,
    }
  }

  start(): Transition {
    this.stack = [{ screenId: this.graph.entry, values: {} }]
    this.completed = false
    return this.mint(this.stack[0]!)
  }

  next(values: FormValues, action: ActionEvent): Transition {
    const current = this.stack.at(-1)
    if (!current || this.completed) {
      throw new Error('MockEngine: next() with no current step — call start() first')
    }
    current.values = values // snapshot as of leaving, so back() can restore it
    const target = this.graph.nodes[current.screenId]!.transitions[action.outputValue]
    if (target === undefined) {
      throw new Error(
        `MockEngine: no transition for outputValue "${action.outputValue}" from "${current.screenId}"`,
      )
    }
    if (target === COMPLETE) {
      this.completed = true
      return { kind: 'complete' }
    }
    // A self-loop pushes a second frame for the same step: same screenId, new instance.
    const frame: Frame = { screenId: target, values }
    this.stack.push(frame)
    return this.mint(frame)
  }

  back(): ScreenTransition | null {
    if (!this.canGoBack()) return null
    if (this.completed) {
      this.completed = false // step back off the end, onto the last step
    } else {
      this.stack.pop() // leave the current step
    }
    return this.mint(this.stack.at(-1)!) // re-entry is a NEW instance
  }

  canGoBack(): boolean {
    return this.completed ? this.stack.length >= 1 : this.stack.length > 1
  }

  step(): number {
    return this.stack.length
  }
}
