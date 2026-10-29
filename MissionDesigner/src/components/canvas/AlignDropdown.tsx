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

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  ChevronDown,
} from 'lucide-react'
import { Button } from '@mission/ui'
import { cn } from '@mission/ui'
import { useFlowStore } from '@/stores/flowStore'

/**
 * Floating align dropdown for the workflow canvas.
 *
 * Rendered inside the SelectionToolbar Panel along with DistributeDropdown.
 * Disabled until the user has multi-selected at least 2 step nodes
 * (Shift/Ctrl-click or marquee). Mirrors the form designer's align dropdown
 * shape and icons so the two surfaces feel like the same tool.
 */
export function AlignDropdown() {
  const selectedCount = useFlowStore((s) => s.nodes.filter((n) => n.selected).length)
  const alignSelectedNodes = useFlowStore((s) => s.alignSelectedNodes)
  const canAlign = selectedCount >= 2

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger disabled={!canAlign} asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(!canAlign && 'text-slate-300 pointer-events-none')}
          title={canAlign ? 'Align selected nodes' : 'Select 2+ nodes to align'}
          aria-label="Align"
        >
          <AlignStartVertical className="size-4" />
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg p-1 min-w-[180px] z-[10000]"
        >
          <DropdownMenu.Item
            disabled={!canAlign}
            onSelect={() => alignSelectedNodes('left')}
            className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded cursor-pointer outline-none select-none text-gray-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 data-[disabled]:text-gray-400 dark:data-[disabled]:text-gray-500 data-[disabled]:cursor-not-allowed data-[disabled]:hover:bg-transparent"
          >
            <AlignStartVertical size={14} /> Align Left
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={!canAlign}
            onSelect={() => alignSelectedNodes('centerH')}
            className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded cursor-pointer outline-none select-none text-gray-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 data-[disabled]:text-gray-400 dark:data-[disabled]:text-gray-500 data-[disabled]:cursor-not-allowed data-[disabled]:hover:bg-transparent"
          >
            <AlignCenterVertical size={14} /> Align Center H
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={!canAlign}
            onSelect={() => alignSelectedNodes('right')}
            className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded cursor-pointer outline-none select-none text-gray-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 data-[disabled]:text-gray-400 dark:data-[disabled]:text-gray-500 data-[disabled]:cursor-not-allowed data-[disabled]:hover:bg-transparent"
          >
            <AlignEndVertical size={14} /> Align Right
          </DropdownMenu.Item>
          <div className="h-px bg-gray-200 dark:bg-slate-700 my-1" />
          <DropdownMenu.Item
            disabled={!canAlign}
            onSelect={() => alignSelectedNodes('top')}
            className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded cursor-pointer outline-none select-none text-gray-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 data-[disabled]:text-gray-400 dark:data-[disabled]:text-gray-500 data-[disabled]:cursor-not-allowed data-[disabled]:hover:bg-transparent"
          >
            <AlignStartHorizontal size={14} /> Align Top
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={!canAlign}
            onSelect={() => alignSelectedNodes('centerV')}
            className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded cursor-pointer outline-none select-none text-gray-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 data-[disabled]:text-gray-400 dark:data-[disabled]:text-gray-500 data-[disabled]:cursor-not-allowed data-[disabled]:hover:bg-transparent"
          >
            <AlignCenterHorizontal size={14} /> Align Center V
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={!canAlign}
            onSelect={() => alignSelectedNodes('bottom')}
            className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded cursor-pointer outline-none select-none text-gray-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 data-[disabled]:text-gray-400 dark:data-[disabled]:text-gray-500 data-[disabled]:cursor-not-allowed data-[disabled]:hover:bg-transparent"
          >
            <AlignEndHorizontal size={14} /> Align Bottom
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
