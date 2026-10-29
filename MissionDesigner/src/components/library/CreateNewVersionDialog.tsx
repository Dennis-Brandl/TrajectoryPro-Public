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
import { toast } from 'sonner'
import { Button } from '@mission/ui'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@mission/ui'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import type { Specification } from '@/types/library'
import { bumpVersion, type BumpType } from '@/types/version'
import { createNewSpecificationVersion } from '@/lib/api/specification-mutations'

function isValidSemver(v: string): boolean {
  const parts = v.split('.')
  if (parts.length !== 3) return false
  return parts.every((p) => /^(0|[1-9]\d*)$/.test(p))
}

export interface CreateNewVersionDialogProps {
  spec: Specification
  siblingVersions: string[] // versions of other specs in the same library with the same name
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (newSpec: Specification) => void
}

export function CreateNewVersionDialog({
  spec,
  siblingVersions,
  open,
  onOpenChange,
  onSuccess,
}: CreateNewVersionDialogProps) {
  const [version, setVersion] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const valid = isValidSemver(version)
  const unchanged = version === spec.version
  const collides = siblingVersions.includes(version)
  const canSubmit = valid && !unchanged && !collides && !submitting

  function bump(type: BumpType) {
    setVersion(bumpVersion(spec.version, type))
  }

  async function handleCreate() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const newSpec = await createNewSpecificationVersion(spec.id, version)
      toast.success(`Created ${newSpec.name} v${newSpec.version}`)
      onSuccess?.(newSpec)
      onOpenChange(false)
      setVersion('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create new version')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Version — {spec.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm">
            <span className="text-slate-500">Current version: </span>
            <span className="font-mono">{spec.version}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">Bump:</span>
            <Button variant="outline" size="sm" onClick={() => bump('major')}>
              Major
            </Button>
            <Button variant="outline" size="sm" onClick={() => bump('minor')}>
              Minor
            </Button>
            <Button variant="outline" size="sm" onClick={() => bump('patch')}>
              Patch
            </Button>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-version">New version</Label>
            <Input id="new-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
            {version && !valid && <p className="text-xs text-red-600">Invalid semver (expected MAJOR.MINOR.PATCH)</p>}
            {valid && unchanged && <p className="text-xs text-red-600">Must differ from current version</p>}
            {valid && !unchanged && collides && (
              <p className="text-xs text-red-600">A version {version} already exists in this library</p>
            )}
          </div>
          <p className="text-xs text-slate-500">
            The new version will be created as a Draft in this library. The current version is unchanged.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
