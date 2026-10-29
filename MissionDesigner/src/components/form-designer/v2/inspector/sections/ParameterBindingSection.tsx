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
import type {
  Block,
  TextInputBlock,
  TextareaBlock,
  TimerBlock,
  CheckboxBlock,
  RadioBlock,
  ESignatureBlock,
} from '@mission/form-schema'
import { useFlowStore } from '@/stores/flowStore'
import { useFormDocumentStore } from '@/stores/formDocumentStore'
import { generateOID, WORKER_INTERNAL } from '@/lib/snowflake'
import type { ParameterSpec } from '@/types/nodes'

type BindableBlock = TextInputBlock | TextareaBlock | TimerBlock | CheckboxBlock | RadioBlock | ESignatureBlock

interface ParameterBindingSectionProps {
  block: Block
  onUpdate: (patch: Partial<Block>) => void
}

const fieldStyle: React.CSSProperties = {
  marginBottom: 10,
}

/**
 * Parameter Binding section for TextInput, Textarea, Timer, Checkbox, and Radio blocks.
 *
 * Output Parameter: dropdown showing the step's own output parameters,
 * with an inline "Add Output Parameter" button to create new ones.
 */
export function ParameterBindingSection({ block: blockProp, onUpdate }: ParameterBindingSectionProps) {
  // renderSections only mounts this section for textInput/textarea/checkbox/radio/timer
  // blocks; narrow once here so the rest of the (ported, v1-shaped) body can read
  // `block.outputParameter` directly.
  const block = blockProp as BindableBlock
  const openNodeId = useFormDocumentStore((s) => s.openNodeId)
  const nodes = useFlowStore((s) => s.nodes)

  const stepOutputs: ParameterSpec[] = useMemo(() => {
    if (!openNodeId) return []
    const node = nodes.find((n) => n.id === openNodeId)
    return (node?.data as { outputs?: ParameterSpec[] })?.outputs || []
  }, [openNodeId, nodes])

  const handleAddOutputParam = () => {
    if (!openNodeId) return
    const currentNodes = useFlowStore.getState().nodes
    const node = currentNodes.find((n) => n.id === openNodeId)
    if (!node) return
    const existing = (node.data as { outputs?: ParameterSpec[] }).outputs || []
    const raw = window.prompt('New output parameter name:')
    if (raw === null) return
    const name = raw.trim()
    if (!name) return
    if (existing.some((p) => p.name === name)) {
      window.alert(`An output parameter named "${name}" already exists.`)
      return
    }
    const newParam: ParameterSpec = { id: generateOID(WORKER_INTERNAL), name, description: '' }
    useFlowStore.getState().updateNodeData(openNodeId, { outputs: [...existing, newParam] })
    onUpdate({ outputParameter: name } as Partial<Block>)
  }

  const handleOutputChange = (target: string) => {
    onUpdate({ outputParameter: target || undefined } as Partial<Block>)
  }

  return (
    <div style={{ padding: '4px 12px 12px' }}>
      {/* Output Parameter — shows step's output parameters */}
      <div style={fieldStyle}>
        <span
          className="text-gray-500 dark:text-gray-400"
          style={{ fontSize: 11, display: 'block', marginBottom: 2, userSelect: 'none' }}
        >
          Output Parameter
        </span>
        <select
          value={block.outputParameter || ''}
          onChange={(e) => {
            const val = e.target.value
            if (val === '__add_output__') {
              handleAddOutputParam()
              // Reset select back to current value
              e.target.value = block.outputParameter || ''
              return
            }
            handleOutputChange(val)
          }}
          className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600"
          style={{
            width: '100%',
            fontSize: 13,
            padding: '4px 8px',
            borderRadius: 4,
            boxSizing: 'border-box',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="">Select output parameter...</option>
          {stepOutputs
            .filter((p) => p.name)
            .map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          <option disabled style={{ borderTop: '1px solid #d1d5db' }}>
            ───────────
          </option>
          <option value="__add_output__" className="text-blue-600 dark:text-blue-400">
            + Add Output Parameter
          </option>
        </select>
      </div>
    </div>
  )
}
