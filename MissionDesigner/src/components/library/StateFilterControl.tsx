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

import { ChevronDown } from 'lucide-react'
import { Button } from '@mission/ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'
import type { SpecificationState } from '@/types/library'

const OPTIONS: Array<SpecificationState | 'all'> = [
  'all',
  'Draft',
  'InTest',
  'InReview',
  'Approved',
  'Effective',
  'Superseded',
  'Obsolete',
]

function label(value: SpecificationState | 'all'): string {
  return value === 'all' ? 'All' : value
}

export function StateFilterControl() {
  const stateFilter = useLibraryStore((s) => s.stateFilter)
  const setStateFilter = useLibraryStore((s) => s.setStateFilter)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
          {label(stateFilter)}
          <ChevronDown className="ml-1 h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt} onClick={() => setStateFilter(opt)}>
            {label(opt)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
