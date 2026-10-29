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

import { useMemo } from 'react'
import { Link2, AlertTriangle } from 'lucide-react'
import { Badge } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'

interface SubWorkflowSelectorProps {
  /** Current sub-workflow mode */
  mode?: 'embedded' | 'reference'
  /** For reference mode: the referenced step spec ID */
  referencedStepSpecId?: string
  /** For reference mode: the library ID containing the step */
  referencedStepLibraryId?: string
  /** For reference mode: the step name (for display if deleted) */
  referencedStepName?: string
}

/**
 * Component for displaying a workflowProxy node's sub-workflow configuration.
 *
 * For embedded mode: nothing is shown — embedded sub-workflows are treated
 * as normal child workflows regardless of whether they were created from
 * scratch or copied from a library.
 *
 * For reference mode: shows the referenced step with validation status
 * and a hint that editing must be done in the step library.
 */
export function SubWorkflowSelector({
  mode,
  referencedStepSpecId,
  referencedStepLibraryId: _referencedStepLibraryId,
  referencedStepName,
}: SubWorkflowSelectorProps) {
  void _referencedStepLibraryId
  const validateStepReference = useLibraryStore((s) => s.validateStepReference)
  const specifications = useLibraryStore((s) => s.specifications)
  const libraries = useLibraryStore((s) => s.libraries)

  // Validate reference if in reference mode
  const isReferenceValid = useMemo(() => {
    if (mode !== 'reference' || !referencedStepSpecId) return true
    return validateStepReference(referencedStepSpecId)
  }, [mode, referencedStepSpecId, validateStepReference])

  // Get referenced step spec info
  const referencedSpecInfo = useMemo(() => {
    if (!referencedStepSpecId) return null
    for (const [libId, specs] of specifications.entries()) {
      const spec = specs.find((s) => s.id === referencedStepSpecId)
      if (spec) {
        const lib = libraries.find((l) => l.id === libId)
        return lib ? { spec, library: lib } : null
      }
    }
    return null
  }, [referencedStepSpecId, specifications, libraries])

  // Embedded sub-workflows are treated as normal child workflows — no indicator needed
  if (mode !== 'reference') return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded border dark:border-slate-700">
        {isReferenceValid ? (
          <Link2 className="h-4 w-4 text-green-500" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Reference to Step</p>
          {referencedSpecInfo ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {referencedSpecInfo.spec.name} in {referencedSpecInfo.library.name}
            </p>
          ) : referencedStepName ? (
            <p className="text-xs text-amber-600 truncate">{referencedStepName} (not found)</p>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500">No step selected</p>
          )}
        </div>
        {!isReferenceValid && (
          <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
            Missing
          </Badge>
        )}
      </div>
      <p className="text-xs text-amber-500 dark:text-amber-400">
        Referenced library steps can only be edited in the step library.
      </p>
    </div>
  )
}
