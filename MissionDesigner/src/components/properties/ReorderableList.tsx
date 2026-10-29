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

import { memo, useCallback, type ReactNode } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import { Button } from '@mission/ui'
import { Label } from '@mission/ui'
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'

/**
 * Generic reorderable list item with stable ID.
 */
export interface ReorderableItem {
  id: string
}

interface ReorderableListProps<T extends ReorderableItem> {
  /** List title shown above the list */
  title: string
  /** Array of items with stable IDs */
  items: T[]
  /** Callback when items change (add, remove, reorder, update) */
  onChange: (items: T[]) => void
  /** Render function for each item (receives item, updateItem, isReadOnly) */
  renderItem: (item: T, updateItem: (id: string, updates: Partial<T>) => void, isReadOnly: boolean) => ReactNode
  /** When true, disables add/remove/reorder */
  readOnly?: boolean
  /** Factory function to create new item with default values */
  createItem: () => T
  /** Optional empty state message */
  emptyMessage?: string
}

function ReorderableListComponent<T extends ReorderableItem>({
  title,
  items,
  onChange,
  renderItem,
  readOnly = false,
  createItem,
  emptyMessage = 'No items defined',
}: ReorderableListProps<T>) {
  const addItem = useCallback(() => {
    onChange([...items, createItem()])
  }, [items, onChange, createItem])

  const updateItem = useCallback(
    (id: string, updates: Partial<T>) => {
      onChange(items.map((item) => (item.id === id ? { ...item, ...updates } : item)))
    },
    [items, onChange],
  )

  const removeItem = useCallback(
    (id: string) => {
      onChange(items.filter((item) => item.id !== id))
    },
    [items, onChange],
  )

  const moveUp = useCallback(
    (index: number) => {
      if (index === 0) return // Already at top
      onChange(arrayMove(items, index, index - 1))
    },
    [items, onChange],
  )

  const moveDown = useCallback(
    (index: number) => {
      if (index === items.length - 1) return // Already at bottom
      onChange(arrayMove(items, index, index + 1))
    },
    [items, onChange],
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">{title}</Label>
        {!readOnly && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={addItem}>
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      {items.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400 italic">{emptyMessage}</p>}

      {items.map((item, index) => (
        <div key={item.id} className="flex gap-1 items-start">
          {!readOnly && (
            <div className="flex flex-col gap-0.5 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0"
                onClick={() => moveUp(index)}
                disabled={index === 0}
                title="Move up"
              >
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0"
                onClick={() => moveDown(index)}
                disabled={index === items.length - 1}
                title="Move down"
              >
                <ArrowDown className="h-3 w-3" />
              </Button>
            </div>
          )}
          <div className="flex-1">{renderItem(item, updateItem, readOnly)}</div>
          {!readOnly && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeItem(item.id)}
              className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
              title="Remove"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

// Export memoized version to prevent unnecessary re-renders
export const ReorderableList = memo(ReorderableListComponent) as typeof ReorderableListComponent
