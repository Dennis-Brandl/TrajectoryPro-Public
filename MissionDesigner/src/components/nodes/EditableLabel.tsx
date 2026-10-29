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

import { useState, useCallback, useRef, useEffect } from 'react'
import { useFlowStore } from '@/stores/flowStore'

interface EditableLabelProps {
  nodeId: string
  label: string
  className?: string
}

export function EditableLabel({ nodeId, label, className = '' }: EditableLabelProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)
  const updateNodeData = useFlowStore((state) => state.updateNodeData)

  useEffect(() => {
    setValue(label)
  }, [label])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsEditing(true)
  }, [])

  const handleBlur = useCallback(() => {
    setIsEditing(false)
    if (value.trim() !== label) {
      updateNodeData(nodeId, { label: value.trim() || label })
    }
  }, [value, label, nodeId, updateNodeData])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        handleBlur()
      } else if (e.key === 'Escape') {
        setValue(label)
        setIsEditing(false)
      }
    },
    [handleBlur, label],
  )

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={`bg-white border border-blue-400 rounded px-1 outline-none text-center nodrag nopan ${className}`}
        style={{ minWidth: '30px' }}
      />
    )
  }

  return (
    <span
      onDoubleClick={handleDoubleClick}
      className={`cursor-text nodrag nopan pointer-events-auto ${className}`}
      title="Double-click to edit"
    >
      {label}
    </span>
  )
}
