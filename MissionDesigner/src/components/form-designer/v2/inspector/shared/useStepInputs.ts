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
import { useMemo } from 'react'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { useFlowStore } from '@/stores/flowStore'
import type { ParameterSpec } from '@/types/nodes'

/** The open step node's named input parameters. Shared by inspector sections that bind to
 *  input parameters (Data + Timer default-value editors). */
export function useStepInputs(): ParameterSpec[] {
  const openNodeId = useFormDocumentStore((s) => s.openNodeId)
  const nodes = useFlowStore((s) => s.nodes)
  return useMemo(() => {
    if (!openNodeId) return []
    const node = nodes.find((n) => n.id === openNodeId)
    return ((node?.data as { inputs?: ParameterSpec[] })?.inputs || []).filter((p) => p.name)
  }, [openNodeId, nodes])
}
