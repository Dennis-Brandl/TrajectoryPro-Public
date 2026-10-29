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

import { AlertTriangle } from 'lucide-react'
import { Button } from '@mission/ui'
import type { ActionSyncState } from '@/lib/action-proxy/sync-state'
import { summarizeSignatureDiff } from '@/lib/action-proxy/signature-sync'
import type { ParameterSpec } from '@/types/nodes'

interface ActionSyncBannerProps {
  state: ActionSyncState
  onApply: (merged: { inputs: ParameterSpec[]; outputs: ParameterSpec[] }) => void
}

/**
 * Spec 2026-09-04 §6.4.2: shown under the Action Reference picker when the step's copied
 * inputs/outputs no longer match the action's definition. "Update from action" hands the
 * merged signature (D8) to the caller, which writes it through the panel draft so autosave and
 * undo cover it. Editability comes from the panel's surrounding <fieldset disabled>.
 */
export function ActionSyncBanner({ state, onApply }: ActionSyncBannerProps) {
  if (state.status !== 'outdated' || !state.diff || !state.merged) return null
  const merged = state.merged
  return (
    <div
      role="status"
      className="rounded border border-amber-300 bg-amber-50 p-2 space-y-1.5 dark:border-amber-700 dark:bg-amber-900/20"
    >
      <div className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <div>
          <p>The action's definition changed since this step was configured.</p>
          <p className="font-mono">{summarizeSignatureDiff(state.diff)}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" data-testid="action-sync-update" onClick={() => onApply(merged)}>
        Update from action
      </Button>
    </div>
  )
}
