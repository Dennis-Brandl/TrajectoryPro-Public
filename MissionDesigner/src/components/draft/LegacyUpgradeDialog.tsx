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

import { useFlowStore } from '@/stores/flowStore'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@mission/ui'

/**
 * One-time notification dialog shown when the persist migration (v1 → v2)
 * detected and removed legacy step nodes from the IndexedDB draft state.
 *
 * Only shown when _legacyNodesRemoved was true in the migrated state.
 */
export function LegacyUpgradeDialog() {
  const show = useFlowStore((s) => s._showLegacyUpgradeNotice)
  const dismiss = useFlowStore((s) => s.dismissLegacyUpgradeNotice)

  return (
    <AlertDialog open={show}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Workflows Updated</AlertDialogTitle>
          <AlertDialogDescription>
            Some legacy steps were removed from your saved workflows during the v4.0 upgrade.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={dismiss}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
