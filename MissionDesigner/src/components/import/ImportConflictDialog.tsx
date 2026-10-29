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

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@mission/ui'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { Button } from '@mission/ui'
import { bumpVersion } from '@/types/version'

export interface ConflictDialogResult {
  action: 'new-workflow' | 'new-version'
  name: string
  version: string
}

interface ImportConflictDialogProps {
  open: boolean
  importedName: string
  importedVersion: string
  existingVersion: string
  onResolve: (result: ConflictDialogResult) => void
  onCancel: () => void
}

/**
 * Dialog shown when the imported workflow name conflicts with an existing one.
 * Lets the user choose to import as a new workflow (with a new name) or as a
 * new version of the existing workflow (name locked, version auto-bumped).
 */
export function ImportConflictDialog({
  open,
  importedName,
  importedVersion,
  existingVersion,
  onResolve,
  onCancel,
}: ImportConflictDialogProps) {
  const [selectedAction, setSelectedAction] = useState<'new-workflow' | 'new-version'>('new-workflow')
  const [name, setName] = useState(importedName)
  const [version, setVersion] = useState(importedVersion)

  // Reset the fields when the dialog opens or the imported values change.
  // Adjust-state-during-render (react.dev "storing information from previous
  // renders") rather than an effect.
  const [resetFor, setResetFor] = useState({ open, importedName, importedVersion })
  if (
    resetFor.open !== open ||
    resetFor.importedName !== importedName ||
    resetFor.importedVersion !== importedVersion
  ) {
    setResetFor({ open, importedName, importedVersion })
    setSelectedAction('new-workflow')
    setName(importedName)
    setVersion(importedVersion)
  }

  function handleSelectAction(action: 'new-workflow' | 'new-version') {
    setSelectedAction(action)
    if (action === 'new-workflow') {
      setName(importedName)
      setVersion(importedVersion)
    } else {
      setName(importedName)
      setVersion(bumpVersion(existingVersion, 'patch'))
    }
  }

  function handleImport() {
    onResolve({ action: selectedAction, name, version })
  }

  const isImportDisabled = name.trim() === '' || version.trim() === ''

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Conflict</DialogTitle>
          <DialogDescription>
            A workflow named &quot;{importedName}&quot; version {existingVersion} already exists.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {/* Option A: Import as new workflow */}
          <div
            className={`cursor-pointer rounded-md p-3 ${selectedAction === 'new-workflow' ? 'border-2 border-primary' : 'border border-muted'}`}
            onClick={() => handleSelectAction('new-workflow')}
          >
            <p className="font-medium text-sm">Import as new workflow</p>
            <p className="text-xs text-muted-foreground mb-3">
              Create a separate workflow with a different name or version.
            </p>
            {selectedAction === 'new-workflow' && (
              <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                <div className="grid gap-1">
                  <Label htmlFor="conflict-name">Name</Label>
                  <Input
                    id="conflict-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Workflow name"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="conflict-version">Version</Label>
                  <Input
                    id="conflict-version"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="1.0.0"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Option B: Import as new version */}
          <div
            className={`cursor-pointer rounded-md p-3 ${selectedAction === 'new-version' ? 'border-2 border-primary' : 'border border-muted'}`}
            onClick={() => handleSelectAction('new-version')}
          >
            <p className="font-medium text-sm">Import as new version</p>
            <p className="text-xs text-muted-foreground mb-3">
              Add a new version to the existing workflow (name is locked).
            </p>
            {selectedAction === 'new-version' && (
              <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                <div className="grid gap-1">
                  <Label htmlFor="conflict-name-readonly">Name</Label>
                  <Input id="conflict-name-readonly" value={name} readOnly className="opacity-60 cursor-not-allowed" />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="conflict-version-new">Version</Label>
                  <Input
                    id="conflict-version-new"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="1.0.1"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={isImportDisabled}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
