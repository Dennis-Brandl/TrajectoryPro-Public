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

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import { useReactFlow } from '@xyflow/react'
import { useShallow } from 'zustand/shallow'
import { useFlowStore } from '@/stores/flowStore'
import { getDerivedLabel } from './FlowCanvas'
import type { WorkflowNode } from '@/types/nodes'

interface CanvasSearchBarProps {
  onClose: () => void
}

/**
 * Ctrl+F overlay for finding nodes by label.
 * Appears as a floating bar at the top of the canvas.
 * Filters nodes by label (case-insensitive), navigates to matches.
 */
export function CanvasSearchBar({ onClose }: CanvasSearchBarProps) {
  const [query, setQuery] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { fitView } = useReactFlow()
  const { nodes, setNodes } = useFlowStore(useShallow((s) => ({ nodes: s.nodes, setNodes: s.setNodes })))

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Filter nodes matching query
  const matches: WorkflowNode[] = useMemo(() => {
    if (!query.trim()) return []
    const lower = query.toLowerCase()
    return nodes.filter((node) => {
      const label = getDerivedLabel(node as WorkflowNode)
      return label.toLowerCase().includes(lower)
    }) as WorkflowNode[]
  }, [query, nodes])

  // Reset the index whenever the match set changes (new query, edited canvas).
  // Adjust-state-during-render (react.dev "storing information from previous
  // renders") rather than an effect, so the reset lands in the same render.
  const [matchCountSeen, setMatchCountSeen] = useState(matches.length)
  if (matches.length !== matchCountSeen) {
    setMatchCountSeen(matches.length)
    setCurrentIndex(0)
  }

  // Navigate to a specific match: fitView + select. `matches` already derives
  // from `nodes`, so depending on `nodes` directly costs nothing extra.
  const navigateToMatch = useCallback(
    (index: number) => {
      if (matches.length === 0) return
      const clamped = ((index % matches.length) + matches.length) % matches.length
      setCurrentIndex(clamped)
      const match = matches[clamped]

      // Select only the matched node
      setNodes(nodes.map((n) => ({ ...n, selected: n.id === match.id })))

      // Zoom to node
      fitView({ nodes: [{ id: match.id }], duration: 200, padding: 0.5 })
    },
    [matches, nodes, setNodes, fitView],
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation() // prevent React Flow from seeing keyboard events

    if (e.key === 'Escape') {
      onClose()
      return
    }

    if (e.key === 'Enter') {
      if (e.shiftKey) {
        // Shift+Enter: previous match
        navigateToMatch(currentIndex - 1)
      } else {
        // Enter: next match
        navigateToMatch(currentIndex)
        // Move to next for subsequent Enter press
        if (matches.length > 1) {
          setCurrentIndex((prev) => (prev + 1) % matches.length)
        }
      }
      return
    }
  }

  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 bg-white rounded-lg shadow-lg border border-slate-200 px-3 py-2"
      style={{ minWidth: 300 }}
    >
      <Search className="h-4 w-4 text-slate-400 flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search nodes..."
        className="flex-1 text-sm outline-none border-none bg-transparent text-slate-700 placeholder:text-slate-400"
      />

      {/* Match count */}
      {query.trim() && (
        <span className="text-xs text-slate-400 whitespace-nowrap">
          {matches.length === 0 ? 'No matches' : `${matches.length > 0 ? currentIndex + 1 : 0} of ${matches.length}`}
        </span>
      )}

      {/* Navigation arrows */}
      {matches.length > 1 && (
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className="p-0.5 rounded hover:bg-slate-100 text-slate-500"
            onClick={() => navigateToMatch(currentIndex - 1)}
            title="Previous match (Shift+Enter)"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="p-0.5 rounded hover:bg-slate-100 text-slate-500"
            onClick={() => navigateToMatch(currentIndex + 1)}
            title="Next match (Enter)"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Close button */}
      <button
        type="button"
        className="p-0.5 rounded hover:bg-slate-100 text-slate-400"
        onClick={onClose}
        title="Close (Escape)"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
