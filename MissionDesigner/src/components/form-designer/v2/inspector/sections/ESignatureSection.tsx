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

// Spec 2026-09-06 §4.1: Label, Meaning, Role (system-wide list, D10 copy-not-link), the
// different-user flag, and the field name. The role list is the first inspector control that
// reads from the server (useESignatureRoles); everything else follows DataSection's shapes.

import type { Block, ESignatureBlock } from '@mission/form-schema'
import { BlockFieldNameInput } from '../shared/BlockFieldNameInput'
import { useDebouncedField } from '../shared/useDebouncedField'
import { useESignatureRoles } from '@/lib/esignature-roles'

interface ESignatureSectionProps {
  block: Block
  onUpdate: (patch: Partial<Block>) => void
  allBlocks: Block[]
}

const fieldStyle: React.CSSProperties = { marginBottom: 10 }
const captionStyle: React.CSSProperties = { fontSize: 11, display: 'block', marginBottom: 2, userSelect: 'none' }
const controlClass =
  'bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 border border-gray-300 dark:border-gray-600'
const controlStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 13,
  padding: '4px 8px',
  borderRadius: 4,
  boxSizing: 'border-box',
  outline: 'none',
}

export function ESignatureSection({ block: blockProp, onUpdate, allBlocks }: ESignatureSectionProps) {
  // renderSections mounts this section for esignature blocks only.
  const block = blockProp as ESignatureBlock
  const { roles, loading, error } = useESignatureRoles()
  const [label, onLabelChange] = useDebouncedField(block.id, block.label ?? '', onUpdate, 'label')
  const [meaning, onMeaningChange] = useDebouncedField(block.id, block.meaning ?? '', onUpdate, 'meaning')
  const roleName = block.roleName ?? ''
  // While the roles list is still loading, `roles` is `[]` on every mount (no cross-mount
  // cache) — a valid stored roleName must not be flagged "not in the list" during that window.
  // It still needs an <option> so the <select>'s value resolves to it (not the first option).
  const roleMissingFromList = roleName !== '' && !roles.includes(roleName)
  const unlisted = !loading && roleMissingFromList

  return (
    <div style={{ padding: '4px 12px 12px' }}>
      <div style={fieldStyle}>
        <BlockFieldNameInput value={block.fieldName} blockId={block.id} allBlocks={allBlocks} onUpdate={onUpdate} />
      </div>

      <div style={fieldStyle}>
        <label htmlFor="esig-label" className="text-gray-500 dark:text-gray-400" style={captionStyle}>
          Label
        </label>
        <input
          id="esig-label"
          type="text"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          className={controlClass}
          style={controlStyle}
          placeholder="E-signature"
        />
      </div>

      <div style={fieldStyle}>
        <label htmlFor="esig-meaning" className="text-gray-500 dark:text-gray-400" style={captionStyle}>
          Meaning
        </label>
        <textarea
          id="esig-meaning"
          rows={3}
          value={meaning}
          onChange={(e) => onMeaningChange(e.target.value)}
          className={controlClass}
          style={{ ...controlStyle, resize: 'vertical' }}
          placeholder="What the signer attests to, e.g. I approve this timesheet as submitted"
        />
      </div>

      <div style={fieldStyle}>
        <label htmlFor="esig-role" className="text-gray-500 dark:text-gray-400" style={captionStyle}>
          Role
        </label>
        {error ? (
          <p className="text-red-600 dark:text-red-400" style={{ fontSize: 12, margin: 0 }}>
            {error}
          </p>
        ) : (
          <select
            id="esig-role"
            value={roleName}
            disabled={loading}
            onChange={(e) => onUpdate({ roleName: e.target.value || undefined } as Partial<Block>)}
            className={controlClass}
            style={{ ...controlStyle, cursor: 'pointer' }}
          >
            <option value="">Any work-center member</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            {roleMissingFromList && (
              <option value={roleName}>
                {unlisted ? `${roleName} (not in the E-signature roles list)` : roleName}
              </option>
            )}
          </select>
        )}
        {unlisted && !error && (
          <p role="status" className="text-amber-600 dark:text-amber-400" style={{ fontSize: 11, margin: '4px 0 0' }}>
            “{roleName}” is not in the E-signature roles list. Add it under Administration or pick another role; the
            form keeps the stored name either way.
          </p>
        )}
      </div>

      <div style={fieldStyle}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!block.requireDifferentUser}
            onChange={() => onUpdate({ requireDifferentUser: !block.requireDifferentUser } as Partial<Block>)}
            style={{ cursor: 'pointer' }}
          />
          <span className="text-gray-700 dark:text-slate-200" style={{ fontSize: 13 }}>
            A different user than the operator must sign
          </span>
        </label>
      </div>
    </div>
  )
}
