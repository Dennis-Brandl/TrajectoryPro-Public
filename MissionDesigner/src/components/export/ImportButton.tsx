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

import { useRef } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@mission/ui'
import type { EntityType, Library, Specification } from '@/types/library'
import { importActionLibrary, importEnvironmentLibrary, importStepLibrary, importWorkflowLibrary } from '@/lib/import'

/**
 * Result from a successful import operation.
 */
export interface ImportResult {
  /** Imported library data (for library mode) */
  library?: Omit<Library, 'id' | 'userId'>
  /** Imported specifications (for library mode) */
  specifications?: Omit<Specification, 'id' | 'libraryId'>[]
  /** Imported child libraries (for library mode with nested children) */
  childLibraries?: ImportResult[]
}

/**
 * Props for the ImportButton component.
 */
export interface ImportButtonProps {
  /** Import mode - determines which import function to use */
  mode: 'library' | 'workflow'
  /** Entity type for library mode - determines validation schema */
  entityType?: EntityType
  /** Callback on successful import */
  onImport: (result: ImportResult) => void
  /** Callback on import error */
  onError: (error: string) => void
  /** Callback for workflow library package (ZIP) import */
  onPackageImport?: (file: File) => void
  /** Whether the button is disabled */
  disabled?: boolean
}

/**
 * File upload button for importing JSON files.
 *
 * In library mode, validates against the appropriate library schema based on entityType.
 *
 * @example
 * ```tsx
 * // Library mode
 * <ImportButton
 *   mode="library"
 *   entityType="action"
 *   onImport={handleImport}
 *   onError={handleError}
 * />
 * ```
 */
/** Maps entityType to the accepted file extensions (library mode only). */
function getAcceptFilter(entityType?: EntityType): string {
  switch (entityType) {
    case 'action':
      return '.WFactionLibX'
    case 'environment':
      // Library mode: env LIBRARY package only. The new single-env package
      // (.WFenvirX) belongs to the "Import Environment" single-spec menu on a
      // library, not this library-level button.
      return '.WFenvirLibX'
    case 'workflow':
      return '.WFlibX,.batchml.xml,.xml'
    case 'step':
      return '.WFstepLibX'
    default:
      return '.WFstepLibX'
  }
}

export function ImportButton({ entityType, onImport, onError, onPackageImport, disabled }: ImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const acceptFilter = getAcceptFilter(entityType)

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      // Read file content for library import
      const text = await file.text()

      // Parse JSON — if parse fails and a package handler exists, treat as ZIP package
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        if (onPackageImport) {
          onPackageImport(file)
          return
        }
        onError('Invalid JSON file')
        return
      }
      // Library import - use entityType to determine import function
      let result
      switch (entityType) {
        case 'action':
          result = importActionLibrary(data)
          break
        case 'environment':
          result = importEnvironmentLibrary(data)
          break
        case 'step':
          result = importStepLibrary(data)
          break
        case 'workflow':
        default:
          result = importWorkflowLibrary(data)
          break
      }

      if ('error' in result) {
        onError(result.error)
        return
      }

      onImport({
        library: result.library,
        specifications: result.specifications,
        childLibraries: result.childLibraries,
      })
    } catch (error) {
      console.error('[import] ImportButton handleFileChange failed:', error)
      onError(error instanceof Error ? error.message : 'Failed to import file')
    } finally {
      // Reset input to allow re-importing the same file
      if (inputRef.current) {
        inputRef.current.value = ''
      }
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={acceptFilter}
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />
      <Button variant="outline" size="sm" onClick={handleClick} disabled={disabled} className="gap-1.5">
        <Upload className="h-4 w-4" />
        {entityType === 'action'
          ? 'Import Action Library'
          : entityType === 'environment'
            ? 'Import Environment Library'
            : 'Import Library'}
      </Button>
    </>
  )
}
