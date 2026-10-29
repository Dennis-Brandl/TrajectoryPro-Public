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

import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { invokeAction } from '../api/invoke'
import type { InvokeInputParameter } from '../api/types'
import { useActiveConnection } from './connections'
import { useActiveInstance } from './active-instance'

export interface InvokeArgs {
  action_oid: string
  environment_oid: string
  input_parameters: InvokeInputParameter[]
  /**
   * Optional per-invoke action-property overrides forwarded to the server
   * (RESTProtocolSpec.md — server vendor extension). Pass `undefined`/omit
   * when no overrides are needed; only forwarded if non-empty.
   */
  action_property_overrides?: Record<string, Record<string, string>>
}

export interface InvokeResultData {
  instance_id: string
}

export function useInvoke(): UseMutationResult<InvokeResultData, Error, InvokeArgs> {
  const connection = useActiveConnection()
  const { trackInstance, selectInstance } = useActiveInstance()

  return useMutation<InvokeResultData, Error, InvokeArgs>({
    mutationFn: async (args) => {
      if (!connection) throw new Error('No active connection')
      const overrides = args.action_property_overrides
      const hasOverrides = overrides && Object.keys(overrides).length > 0
      return invokeAction(connection, args.action_oid, {
        environment_oid: args.environment_oid,
        workflow_instance_id: crypto.randomUUID(),
        step_instance_id: crypto.randomUUID(),
        step_oid: crypto.randomUUID(),
        input_parameters: args.input_parameters,
        ...(hasOverrides && { action_property_overrides: overrides }),
      })
    },
    onSuccess: (data, args) => {
      if (!connection) return
      trackInstance({
        instance_id: data.instance_id,
        connection_id: connection.id,
        action_oid: args.action_oid,
      })
      selectInstance(data.instance_id)
    },
  })
}
