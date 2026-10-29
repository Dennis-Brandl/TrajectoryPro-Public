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
import { proxyTimeoutMs, setProxyTimeout } from '@/lib/action-proxy/default-timeout'
import type { ParameterSpec, StepNodeData } from '@/types/nodes'

export interface SelectedAction {
  name: string
  libraryName: string
  actionOid: string
  environmentSpecId: string
  inputs: ParameterSpec[]
  outputs: ParameterSpec[]
}

/**
 * Maps a gear-picker selection onto the node draft. Besides the design-time
 * name fields, this WRITES the runtime oid binding (actionProxyConfig): the
 * picker resolved a concrete action spec, so the stored runtime contract must
 * follow the selection instead of fossilizing whatever the last import wrote
 * (spec 2026-08-21 action-proxy name binding). Authored timeout_ms survives;
 * there is no default, so an action picked with none authored gets no deadline.
 */
export function actionSelectionToDraft(
  action: SelectedAction,
  prev: Pick<StepNodeData, 'actionProxyConfig'>,
): Partial<StepNodeData> {
  const identity: { action_oid: string; environment_oid: string; timeout_ms?: number } = {
    action_oid: action.actionOid,
    environment_oid: action.environmentSpecId,
  }
  return {
    label: action.name,
    actionName: action.name,
    actionLibraryName: action.libraryName,
    environmentSpecId: action.environmentSpecId,
    inputs: action.inputs,
    outputs: action.outputs,
    actionProxyConfig: setProxyTimeout(identity, proxyTimeoutMs(prev.actionProxyConfig?.timeout_ms)),
  }
}
