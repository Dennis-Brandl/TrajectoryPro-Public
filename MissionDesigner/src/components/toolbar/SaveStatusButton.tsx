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

import { Save } from 'lucide-react'
import { Button } from '@mission/ui'

/**
 * Save-status button shared by the workflow canvas toolbar, the env/action/library
 * detail views, and any other surface that drives a debounced server flush.
 *
 * Renders as a regular outline button when there are pending changes, switches
 * to the destructive variant + a "retry" label when the last flush errored,
 * and is disabled when there's nothing to save and no error to retry.
 *
 * The component is a thin presentational wrapper — the parent owns the
 * dirty/error state and the onSave handler (which typically calls
 * `flushNow()` from the appropriate save scheduler).
 */
export interface SaveStatusButtonProps {
  /** True when there are pending changes that haven't reached the server. */
  isDirty: boolean
  /**
   * Last server-flush error, if any. Puts the button in the destructive/retry
   * state. Accepts any shape with a readable `message` so each surface can pass
   * its own store's error type (e.g., specStore's `SaveError`, an `Error`, etc.).
   */
  lastSaveError: { message: string } | null
  /** Click handler — typically calls flushNow() or an equivalent. */
  onSave: () => void | Promise<void>
  /** Button text in the normal state. Defaults to "Save". */
  label?: string
  /** Button text in the error state. Defaults to "Retry save". */
  errorLabel?: string
  /** Tooltip in the normal state. Defaults to `label`. */
  tooltip?: string
  className?: string
}

export function SaveStatusButton({
  isDirty,
  lastSaveError,
  onSave,
  label = 'Save',
  errorLabel = 'Retry save',
  tooltip,
  className,
}: SaveStatusButtonProps) {
  const titleText = lastSaveError ? `${errorLabel} — last error: ${lastSaveError.message}` : (tooltip ?? label)
  return (
    <Button
      variant={lastSaveError ? 'destructive' : 'outline'}
      size="sm"
      onClick={onSave}
      disabled={!isDirty && !lastSaveError}
      className={`gap-1.5 ${className ?? ''}`}
      title={titleText}
    >
      <Save className="h-4 w-4" />
      {lastSaveError ? errorLabel : label}
    </Button>
  )
}
