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

import { useState, useMemo, useCallback } from 'react'
import { FilePlus, Copy, Link2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@mission/ui'
import { Button } from '@mission/ui'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { RadioGroup, RadioGroupItem } from '@mission/ui'
import { StepLibraryPicker } from './StepLibraryPicker'
import type { Library, Specification } from '@/types/library'
import type { ParameterSpec, ValueSpec, StepResourceCommand } from '@/types/nodes'
import type { XYPosition } from '@xyflow/react'
import { cn } from '@mission/ui'

type CreationMode = 'new' | 'copy' | 'reference'

interface SubWorkflowCreationDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Called when dialog should close */
  onClose: () => void
  /** Called when creation is confirmed */
  onCreate: (result: SubWorkflowCreationResult) => void
  /** Position where the node will be created */
  position: XYPosition | null
}

export interface SubWorkflowCreationResult {
  mode: 'embedded' | 'reference'
  position: XYPosition
  /** For embedded new: name for the new workflow spec */
  newSpecName?: string
  /** For embedded copy: source step spec */
  sourceSpec?: Specification
  sourceLibrary?: Library
  /** For reference: referenced step spec */
  referencedSpec?: Specification
  referencedLibrary?: Library
  /** Inputs/outputs/values/resources from source or reference */
  inputs?: ParameterSpec[]
  outputs?: ParameterSpec[]
  values?: ValueSpec[]
  resourceCommands?: StepResourceCommand[]
}

/**
 * Modal dialog shown when dropping a workflowProxy node from the StepPalette.
 *
 * Offers three creation options:
 * 1. Create New Empty Workflow
 * 2. Copy from Library Step
 * 3. Reference Library Step
 */
export function SubWorkflowCreationDialog({ open, onClose, onCreate, position }: SubWorkflowCreationDialogProps) {
  const [creationMode, setCreationMode] = useState<CreationMode>('new')
  const [newSpecName, setNewSpecName] = useState('New Sub-Workflow')
  const [selectedSpec, setSelectedSpec] = useState<Specification | null>(null)
  const [selectedLibrary, setSelectedLibrary] = useState<Library | null>(null)

  // Reset state when dialog opens
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        onClose()
        // Reset state after closing
        setTimeout(() => {
          setCreationMode('new')
          setNewSpecName('New Sub-Workflow')
          setSelectedSpec(null)
          setSelectedLibrary(null)
        }, 150)
      }
    },
    [onClose],
  )

  // Handle step selection
  const handleStepSelect = useCallback((spec: Specification, library: Library) => {
    setSelectedSpec(spec)
    setSelectedLibrary(library)
  }, [])

  // Validate based on mode
  const isValid = useMemo(() => {
    switch (creationMode) {
      case 'new':
        return newSpecName.trim().length > 0
      case 'copy':
      case 'reference':
        return selectedSpec !== null && selectedLibrary !== null
      default:
        return false
    }
  }, [creationMode, newSpecName, selectedSpec, selectedLibrary])

  // Handle create button
  const handleCreate = useCallback(() => {
    if (!position || !isValid) return

    const specData = selectedSpec?.data as
      | {
          inputs?: ParameterSpec[]
          outputs?: ParameterSpec[]
          workflowInputs?: ParameterSpec[]
          workflowOutputs?: ParameterSpec[]
          values?: ValueSpec[]
          resourceCommands?: StepResourceCommand[]
        }
      | undefined
    // Use step-level inputs/outputs if present, otherwise fall back to workflow-level parameters
    const inputs = specData?.inputs?.length ? specData.inputs : specData?.workflowInputs || []
    const outputs = specData?.outputs?.length ? specData.outputs : specData?.workflowOutputs || []
    const values = specData?.values || []
    const resourceCommands = specData?.resourceCommands || []

    switch (creationMode) {
      case 'new':
        onCreate({
          mode: 'embedded',
          position,
          newSpecName: newSpecName.trim(),
        })
        break
      case 'copy':
        if (selectedSpec && selectedLibrary) {
          onCreate({
            mode: 'embedded',
            position,
            sourceSpec: selectedSpec,
            sourceLibrary: selectedLibrary,
            inputs,
            outputs,
            values,
            resourceCommands,
          })
        }
        break
      case 'reference':
        if (selectedSpec && selectedLibrary) {
          onCreate({
            mode: 'reference',
            position,
            referencedSpec: selectedSpec,
            referencedLibrary: selectedLibrary,
            inputs,
            outputs,
            values,
            resourceCommands,
          })
        }
        break
    }

    handleOpenChange(false)
  }, [position, isValid, creationMode, newSpecName, selectedSpec, selectedLibrary, onCreate, handleOpenChange])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Sub-Workflow</DialogTitle>
          <DialogDescription>Choose how to create the sub-workflow step.</DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <RadioGroup
            value={creationMode}
            onValueChange={(value) => setCreationMode(value as CreationMode)}
            className="space-y-3"
          >
            {/* Create New Empty */}
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="new" id="mode-new" className="mt-1" />
              <div className="flex-1">
                <Label
                  htmlFor="mode-new"
                  className={cn('flex items-center gap-2 cursor-pointer', creationMode === 'new' && 'text-blue-700')}
                >
                  <FilePlus className="h-4 w-4" />
                  Create New Empty Workflow
                </Label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Creates a new workflow specification that you can edit.
                </p>
                {creationMode === 'new' && (
                  <div className="mt-2">
                    <Label className="text-xs">Workflow Name</Label>
                    <Input
                      value={newSpecName}
                      onChange={(e) => setNewSpecName(e.target.value)}
                      placeholder="Enter name..."
                      className="h-8 mt-1"
                      autoFocus
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Copy from Library */}
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="copy" id="mode-copy" className="mt-1" />
              <div className="flex-1">
                <Label
                  htmlFor="mode-copy"
                  className={cn('flex items-center gap-2 cursor-pointer', creationMode === 'copy' && 'text-blue-700')}
                >
                  <Copy className="h-4 w-4" />
                  Copy from Library Step
                </Label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Creates a new workflow by copying a step's content.
                </p>
                {creationMode === 'copy' && (
                  <div className="mt-2">
                    <StepLibraryPicker onSelect={handleStepSelect} selectedSpecId={selectedSpec?.id} />
                    {selectedSpec && <p className="text-xs text-blue-600 mt-1">Selected: {selectedSpec.name}</p>}
                  </div>
                )}
              </div>
            </div>

            {/* Reference Library Step */}
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="reference" id="mode-reference" className="mt-1" />
              <div className="flex-1">
                <Label
                  htmlFor="mode-reference"
                  className={cn(
                    'flex items-center gap-2 cursor-pointer',
                    creationMode === 'reference' && 'text-blue-700',
                  )}
                >
                  <Link2 className="h-4 w-4" />
                  Reference Library Step
                </Label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Links to an existing step. Changes to the step are reflected here.
                </p>
                {creationMode === 'reference' && (
                  <div className="mt-2">
                    <StepLibraryPicker onSelect={handleStepSelect} selectedSpecId={selectedSpec?.id} />
                    {selectedSpec && <p className="text-xs text-green-600 mt-1">Selected: {selectedSpec.name}</p>}
                  </div>
                )}
              </div>
            </div>
          </RadioGroup>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!isValid}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
