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
import type { ButtonBlock } from '@mission/form-schema'
import { JOB_DEFAULT_LABEL, signedLabel } from '@mission/form-schema'
import { useFormRenderer } from '../context'
import { sizeClasses, useAuthoredColor } from './common'

export function ButtonBlockView({ block }: { block: ButtonBlock }) {
  const { emit, buttonJobs } = useFormRenderer()
  // Spec §14 compares the authored background with the surface.
  const color = useAuthoredColor(block.color)
  const job = block.job
  const state = job ? buttonJobs?.[job] : undefined
  let label = block.label
  if (job) {
    label = block.label.trim() || state?.label || JOB_DEFAULT_LABEL[job]
    if (buttonJobs?.signed && job !== 'no') label = signedLabel(label)
  }
  const disabled = job ? state?.enabled === false : false
  // No size authored means no size class: the button keeps today's look.
  const sized = block.size || block.sizeAt ? ` ${sizeClasses(block.size, block.sizeAt, 'md')}` : ''
  return (
    <button
      type="button"
      className={`tfk-button tfk-button-${block.emphasis ?? 'primary'}${sized}`}
      style={color && !disabled ? { background: color } : undefined}
      disabled={disabled || undefined}
      aria-describedby={job ? state?.describedBy : undefined}
      aria-keyshortcuts={job === 'continue' ? 'Control+Enter' : undefined}
      onClick={() =>
        job
          ? emit({ kind: 'job', blockId: block.id, job })
          : emit({ kind: 'action', blockId: block.id, outputValue: block.outputValue })
      }
    >
      {label}
    </button>
  )
}
