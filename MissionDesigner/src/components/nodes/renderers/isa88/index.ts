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

import type { NodeTypes } from '@xyflow/react'
import StartNode from '../unified/StartNode'
import EndNode from '../unified/EndNode'
import ActionProxyWaitNode from '../unified/ActionProxyWaitNode'
import YesNoStepNode from '../unified/YesNoStepNode'
import ScriptStepNode from '../unified/ScriptStepNode'
import GateNode from '../unified/GateNode'
import WorkflowProxyNode from '../unified/WorkflowProxyNode'
import Select1Node from '../unified/Select1Node'
import WaitAnyNode from '../unified/WaitAnyNode'
import ParallelNode from '../unified/ParallelNode'
import WaitAllNode from '../unified/WaitAllNode'
import UserInteractionStepNode from '../unified/UserInteractionStepNode'
import CatchNode from '../unified/CatchNode'
import ReturnNode from '../unified/ReturnNode'

// CRITICAL: Define at module scope to prevent re-renders.
// Separate object per notation for React Flow referential stability.
export const isa88NodeTypes: NodeTypes = {
  start: StartNode,
  end: EndNode,
  actionProxyWait: ActionProxyWaitNode,
  yesNoStep: YesNoStepNode,
  scriptStep: ScriptStepNode,
  gateStep: GateNode,
  workflowProxy: WorkflowProxyNode,
  select1: Select1Node,
  waitAny: WaitAnyNode,
  parallel: ParallelNode,
  waitAll: WaitAllNode,
  userInteractionStep: UserInteractionStepNode,
  catch: CatchNode,
  return: ReturnNode,
}
