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

import { Download, FileJson, Image, FileCode2, FileText, FileBox } from 'lucide-react'
import { Button } from '@mission/ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@mission/ui'

/**
 * Props for the ExportMenu component.
 */
export interface ExportMenuProps {
  /** Export mode - determines which options are shown */
  mode: 'library' | 'workflow'
  /** Callback when "Export as JSON" is clicked. Pass null to hide the option entirely. */
  onExportJSON?: (() => void) | null
  /** Callback when "Export as PNG" is clicked (workflow mode only) */
  onExportPNG?: () => void
  /** Callback when "Export as SVG" is clicked (workflow mode only) */
  onExportSVG?: () => void
  /** Callback when "Export as PDF" is clicked */
  onExportPDF?: () => void
  /** Callback when "Export BatchML" is clicked (workflow mode only). */
  onExportBatchml?: () => void
  /** Override the JSON export menu item label */
  jsonLabel?: string
  /** Whether the menu is disabled */
  disabled?: boolean
}

/**
 * Dropdown menu component for export options.
 *
 * In library mode, only shows JSON export.
 * In workflow mode, shows JSON, PNG, and SVG export options.
 *
 * @example
 * ```tsx
 * // Library mode
 * <ExportMenu mode="library" onExportJSON={handleExportJSON} />
 *
 * // Workflow mode
 * <ExportMenu
 *   mode="workflow"
 *   onExportJSON={handleExportJSON}
 *   onExportPNG={handleExportPNG}
 *   onExportSVG={handleExportSVG}
 * />
 * ```
 */
export function ExportMenu({
  mode,
  onExportJSON,
  onExportPNG,
  onExportSVG,
  onExportPDF,
  onExportBatchml,
  jsonLabel,
  disabled,
}: ExportMenuProps) {
  // Disable if no callbacks are provided
  const isDisabled = disabled || (!onExportJSON && !onExportPNG && !onExportSVG && !onExportPDF && !onExportBatchml)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isDisabled} className="gap-1.5">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* JSON/ZIP export - hidden when onExportJSON is null */}
        {onExportJSON !== null && (
          <DropdownMenuItem onClick={onExportJSON ?? undefined} disabled={!onExportJSON} className="cursor-pointer">
            <FileJson className="h-4 w-4" />
            {jsonLabel ?? (mode === 'library' ? 'Export as JSON Library' : 'Export as Workflow ZIP')}
          </DropdownMenuItem>
        )}

        {/* PDF export - both modes */}
        {onExportPDF && (
          <DropdownMenuItem onClick={onExportPDF} className="cursor-pointer">
            <FileText className="h-4 w-4" />
            Export as PDF
          </DropdownMenuItem>
        )}

        {/* PNG export - workflow mode only */}
        {mode === 'workflow' && (
          <DropdownMenuItem onClick={onExportPNG} disabled={!onExportPNG} className="cursor-pointer">
            <Image className="h-4 w-4" />
            Export as PNG Workflow
          </DropdownMenuItem>
        )}

        {/* SVG export - workflow mode only */}
        {mode === 'workflow' && (
          <DropdownMenuItem onClick={onExportSVG} disabled={!onExportSVG} className="cursor-pointer">
            <FileCode2 className="h-4 w-4" />
            Export as SVG Workflow
          </DropdownMenuItem>
        )}

        {/* BatchML export - workflow mode only */}
        {mode === 'workflow' && onExportBatchml && (
          <DropdownMenuItem onClick={onExportBatchml} className="cursor-pointer">
            <FileBox className="h-4 w-4" />
            Export as BatchML (ISA-88)
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
