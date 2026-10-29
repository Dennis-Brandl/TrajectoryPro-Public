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
import { Button } from '@mission/ui'
import { Textarea } from '@mission/ui'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@mission/ui'
import { type BumpType, bumpVersion } from '@/types/version'

interface BumpVersionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentVersion: string
  onConfirm: (newVersion: string, reason?: string) => void
}

const LEVEL_LABEL: Record<BumpType, string> = {
  major: 'Major',
  minor: 'Minor',
  patch: 'Patch',
}

export function BumpVersionDialog({ open, onOpenChange, currentVersion, onConfirm }: BumpVersionDialogProps) {
  const [reason, setReason] = useState('')
  const [confirmingType, setConfirmingType] = useState<BumpType | null>(null)

  const reasonValid = reason.trim().length > 0
  const targetVersion = confirmingType ? bumpVersion(currentVersion, confirmingType) : null

  const reset = () => {
    setReason('')
    setConfirmingType(null)
  }

  const handleClose = () => {
    reset()
    onOpenChange(false)
  }

  const handleSelectLevel = (type: BumpType) => {
    if (!reasonValid) return
    setConfirmingType(type)
  }

  const handleConfirm = () => {
    if (!confirmingType || !reasonValid) return
    const newVersion = bumpVersion(currentVersion, confirmingType)
    onConfirm(newVersion, reason.trim())
    reset()
    onOpenChange(false)
  }

  const majorPreview = bumpVersion(currentVersion, 'major')
  const minorPreview = bumpVersion(currentVersion, 'minor')
  const patchPreview = bumpVersion(currentVersion, 'patch')

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{confirmingType ? `Update ${LEVEL_LABEL[confirmingType]} Version` : 'Bump Version'}</DialogTitle>
          <DialogDescription>
            {confirmingType ? (
              <>
                <span className="font-mono font-semibold">{currentVersion}</span>
                {' → '}
                <span className="font-mono font-semibold">{targetVersion}</span>
              </>
            ) : (
              <>
                Current version: <span className="font-mono font-semibold">{currentVersion}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block">
              Reason for version change <span className="text-red-500">*</span>
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you bumping the version?"
              className="resize-y"
              rows={4}
              required
              aria-invalid={!reasonValid && !confirmingType}
              disabled={confirmingType !== null}
            />
            {!reasonValid && !confirmingType && <p className="text-xs text-red-500 mt-1">A reason is required.</p>}
          </div>
          {confirmingType ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleConfirm}>
                Update {LEVEL_LABEL[confirmingType]}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => handleSelectLevel('major')}
                disabled={!reasonValid}
              >
                Major
                <span className="ml-1 text-xs text-muted-foreground font-mono">{majorPreview}</span>
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => handleSelectLevel('minor')}
                disabled={!reasonValid}
              >
                Minor
                <span className="ml-1 text-xs text-muted-foreground font-mono">{minorPreview}</span>
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => handleSelectLevel('patch')}
                disabled={!reasonValid}
              >
                Patch
                <span className="ml-1 text-xs text-muted-foreground font-mono">{patchPreview}</span>
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
