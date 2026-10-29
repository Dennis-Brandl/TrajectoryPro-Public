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
import { BumpVersionDialog } from './BumpVersionDialog'

interface VersionBadgeProps {
  version: string
  onBump: (newVersion: string, reason?: string) => void
  disabled?: boolean
}

export function VersionBadge({ version, onBump, disabled }: VersionBadgeProps) {
  const [showBumpDialog, setShowBumpDialog] = useState(false)

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowBumpDialog(true)}
        disabled={disabled}
        className="font-mono text-xs h-7 px-2"
        title="Click to bump version"
      >
        v{version}
      </Button>
      <BumpVersionDialog
        open={showBumpDialog}
        onOpenChange={setShowBumpDialog}
        currentVersion={version}
        onConfirm={onBump}
      />
    </>
  )
}
