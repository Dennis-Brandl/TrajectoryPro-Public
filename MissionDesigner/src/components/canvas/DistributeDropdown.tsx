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
import { Rows3, ChevronDown } from 'lucide-react'
import { Button } from '@mission/ui'
import { cn } from '@mission/ui'
import { useFlowStore } from '@/stores/flowStore'

/**
 * Floating distribute dropdown for the workflow canvas.
 *
 * Disabled until the user has multi-selected at least 3 step nodes.
 * Mirrors the form designer's distribute dropdown shape and icon so the
 * two surfaces feel like the same tool.
 */
export function DistributeDropdown() {
  const selectedCount = useFlowStore((s) => s.nodes.filter((n) => n.selected).length)
  const distributeSelectedNodes = useFlowStore((s) => s.distributeSelectedNodes)
  const canDistribute = selectedCount >= 3

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger disabled={!canDistribute} asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(!canDistribute && 'text-slate-300 pointer-events-none')}
          title={canDistribute ? 'Distribute selected nodes' : 'Select 3+ nodes to distribute'}
          aria-label="Distribute"
        >
          <Rows3 className="size-4" />
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg p-1 min-w-[180px] z-[10000]"
        >
          <DropdownMenu.Item
            disabled={!canDistribute}
            onSelect={() => distributeSelectedNodes('horizontal')}
            className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded cursor-pointer outline-none select-none text-gray-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 data-[disabled]:text-gray-400 dark:data-[disabled]:text-gray-500 data-[disabled]:cursor-not-allowed data-[disabled]:hover:bg-transparent"
          >
            Distribute Horizontally
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={!canDistribute}
            onSelect={() => distributeSelectedNodes('vertical')}
            className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] rounded cursor-pointer outline-none select-none text-gray-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 data-[disabled]:text-gray-400 dark:data-[disabled]:text-gray-500 data-[disabled]:cursor-not-allowed data-[disabled]:hover:bg-transparent"
          >
            Distribute Vertically
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
