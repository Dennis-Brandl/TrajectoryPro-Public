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
import type {
  WorkflowNode,
  StepNodeData,
  NodeType,
  ParameterSpec,
  ValueSpec,
  StepResourceCommand,
  UIParameterSpec,
  Select1OptionSpec,
} from '@/types/nodes'

let nodeCounter = 0

/**
 * Builder pattern for constructing WorkflowNode instances for tests.
 *
 * Usage:
 *   const node = buildNode('actionProxyWait').label('My Action').inputs([...]).build()
 */
export function buildNode(type: NodeType) {
  const id = `test-node-${++nodeCounter}`
  const data: StepNodeData = {
    label: type,
    stepType: type,
  }
  const position = { x: 0, y: 0 }

  const builder = {
    id(newId: string) {
      return Object.assign(Object.create(builder), { _id: newId })
    },
    label(label: string) {
      data.label = label
      return builder
    },
    position(x: number, y: number) {
      position.x = x
      position.y = y
      return builder
    },
    description(desc: string) {
      data.description = desc
      return builder
    },
    inputs(inputs: ParameterSpec[]) {
      data.inputs = inputs
      return builder
    },
    outputs(outputs: ParameterSpec[]) {
      data.outputs = outputs
      return builder
    },
    values(values: ValueSpec[]) {
      data.values = values
      return builder
    },
    resourceCommands(cmds: StepResourceCommand[]) {
      data.resourceCommands = cmds
      return builder
    },
    uiParameters(params: UIParameterSpec[]) {
      data.uiParameters = params
      return builder
    },
    actionName(name: string) {
      data.actionName = name
      return builder
    },
    select1Options(opts: Select1OptionSpec[]) {
      data.select1Options = opts
      return builder
    },
    scriptSource(src: string) {
      data.scriptSource = src
      return builder
    },
    data(extra: Partial<StepNodeData>) {
      Object.assign(data, extra)
      return builder
    },
    build(): WorkflowNode {
      return {
        id: (builder as any)._id ?? id,
        type,
        position: { ...position },
        data: { ...data },
      }
    },
  }

  return builder
}

/**
 * Quick helper to create a minimal node without the builder.
 */
export function makeNode(id: string, type: NodeType, extra?: Partial<StepNodeData>): WorkflowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: type, stepType: type, ...extra },
  }
}

/**
 * Reset the node counter (call in beforeEach for deterministic IDs).
 */
export function resetNodeCounter() {
  nodeCounter = 0
}
