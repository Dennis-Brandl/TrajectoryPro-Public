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

import { MoreHorizontal } from 'lucide-react'
import { Button } from '@mission/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mission/ui'

export interface LibraryItemMenuProps {
  canChangeState: boolean
  canCreateVersion: boolean
  canDeleteSpec: boolean
  onExportPackage?: () => void
  onExportPDF: () => void
  onChangeState: () => void
  onCreateVersion: () => void
  onDelete: () => void
}

export function LibraryItemMenu({
  canChangeState,
  canCreateVersion,
  canDeleteSpec,
  onExportPackage,
  onExportPDF,
  onChangeState,
  onCreateVersion,
  onDelete,
}: LibraryItemMenuProps) {
  // The menu appears when the user has any write capability on this spec.
  // Exports are read-only and ride along once the menu is shown.
  if (!canChangeState && !canCreateVersion && !canDeleteSpec) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
          aria-label="Item actions"
        >
          <MoreHorizontal className="h-3 w-3 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {onExportPackage && <DropdownMenuItem onClick={onExportPackage}>Export as Package</DropdownMenuItem>}
        <DropdownMenuItem onClick={onExportPDF}>Export as PDF</DropdownMenuItem>
        {canChangeState && <DropdownMenuItem onClick={onChangeState}>Change State…</DropdownMenuItem>}
        {canCreateVersion && <DropdownMenuItem onClick={onCreateVersion}>Create New Version…</DropdownMenuItem>}
        {canDeleteSpec && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-red-600 focus:text-red-700">
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
