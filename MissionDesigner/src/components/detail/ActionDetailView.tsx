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

import { useEffect, useState } from 'react'
import { Zap, X, Download, History } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { Textarea } from '@mission/ui'
import { Button } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { flushNow } from '@/stores/specificationStore/saveScheduler'
import { exportSingleAction } from '@/lib/export'
import { useSpecificationById } from '@/hooks/useSpecificationById'
import { ValuesEditor } from '@/components/properties/ValuesEditor'
import { createDefaultEntries } from '@/lib/value-utils'
import type { ValueSpec, ValueEntrySpec } from '@/types/nodes'
import { useUserName } from '@/stores/principalStore'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import { VersionBadge, VersionHistoryDialog } from '@/components/version'
import { createVersionEntry, parseVersionHistory } from '@/types/version'
import { bumpErrorMessage, updateSpecificationVersion } from '@/lib/api/specification-mutations'
import { SaveStatusButton } from '@/components/toolbar/SaveStatusButton'

interface ActionData extends Record<string, unknown> {
  inputs?: ValueSpec[]
  outputs?: ValueSpec[]
  actionVisibility?: 'opaque' | 'observable'
  versionHistory?: string
}

/** Migrate legacy flat parameter/value objects to ValueSpec with entries. Pure. */
function migrateToValueSpecs(
  raw: Array<ValueSpec & { value?: string; description?: string; schema?: string; target?: string }>,
): ValueSpec[] {
  return raw.map((v) => {
    if (v.entries) return v as ValueSpec
    const entries: ValueEntrySpec[] = createDefaultEntries()
    if (v.value) {
      const valueEntry = entries.find((e) => e.name === 'Value')
      if (valueEntry) valueEntry.value = v.value
    }
    if (v.description) {
      const descEntry = entries.find((e) => e.name === 'Description')
      if (descEntry) descEntry.value = v.description
    }
    return { id: v.id, name: v.name, entries }
  })
}

/** Read the current ActionData for a spec from the store. */
function readActionData(specId: string): ActionData {
  const spec = useSpecificationStore.getState().specs.get(specId)
  return ((spec?.data as ActionData) ?? {}) as ActionData
}

/**
 * Form-based detail view for editing action specifications.
 *
 * Edits write through to specificationStore on every change, mirroring the
 * workflow canvas pattern. The save status button drives an explicit/manual
 * server flush; the debounced auto-flush (`scheduleFlush`) runs in the
 * background regardless. Discard reverts to the pre-edit snapshot captured
 * the first time the user touched this spec since its last server save.
 */
export function ActionDetailView() {
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)
  const selectedLibraryId = useLibraryStore((s) => s.selectedLibraryId)
  const libraries = useLibraryStore((s) => s.libraries)
  const setSelectedSpecification = useLibraryStore((s) => s.setSelectedSpecification)
  const { spec: selectedSpec } = useSpecificationById(selectedSpecificationId)
  const library = libraries.find((l) => l.id === selectedLibraryId)

  // Dirty / save state from the store — same source the canvas toolbar reads.
  const isDirty = useSpecificationStore((s) =>
    selectedSpecificationId ? s.dirtyIds.has(selectedSpecificationId) : false,
  )
  const lastSaveError = useSpecificationStore((s) => s.lastSaveError)

  // Local buffer for the `name` field only, so empty/whitespace input is held
  // back from the store and never reaches the server (which would reject it).
  // All other fields write through unconditionally on every change.
  const [nameBuffer, setNameBuffer] = useState('')

  // UI-only state
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const userName = useUserName()
  const canEdit = useCanEditActiveSpec()

  // Sync the name buffer to the spec's name on hydration / spec change /
  // discard. Updates from typing are written through to the store and come
  // back as the same string — a no-op here. Adjust-state-during-render
  // (react.dev "storing information from previous renders") rather than an
  // effect, so the buffer never paints one frame stale.
  const [syncedName, setSyncedName] = useState<{ id: string; name: string } | null>(null)
  if (selectedSpec && (syncedName?.id !== selectedSpec.id || syncedName?.name !== selectedSpec.name)) {
    setSyncedName({ id: selectedSpec.id, name: selectedSpec.name })
    setNameBuffer(selectedSpec.name)
  }

  // One-shot legacy-shape migration when a spec with the old flat
  // inputs/outputs is first loaded. Persists via the same write-through path.
  useEffect(() => {
    if (!selectedSpec) return
    const data = (selectedSpec.data as ActionData) ?? {}
    const rawInputs = data.inputs ?? []
    const rawOutputs = data.outputs ?? []
    const needsMigration = rawInputs.some((v) => !v.entries) || rawOutputs.some((v) => !v.entries)
    if (!needsMigration) return
    useSpecificationStore.getState().updateSpecData(selectedSpec.id, {
      inputs: migrateToValueSpecs(rawInputs),
      outputs: migrateToValueSpecs(rawOutputs),
    })
  }, [selectedSpec?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedSpecificationId || !selectedSpec) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="text-center">
          <Zap className="h-12 w-12 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 dark:text-slate-400">Select an action from the library</p>
          <p className="text-sm text-slate-400 mt-1">Choose an action specification to view and edit its details</p>
        </div>
      </div>
    )
  }

  const specId = selectedSpecificationId
  const data = (selectedSpec.data as ActionData) ?? {}
  const inputs = data.inputs ?? []
  const outputs = data.outputs ?? []
  const actionVisibility: 'opaque' | 'observable' = data.actionVisibility ?? 'opaque'
  const description = selectedSpec.description ?? ''
  const specVersion = selectedSpec.version || '1.0.0'
  const specVersionHistory = parseVersionHistory(data.versionHistory)

  const nameInvalid = !nameBuffer.trim()

  // Top-level field handlers
  const handleNameChange = (value: string) => {
    setNameBuffer(value)
    if (value.trim() === '') return // hold invalid input in local buffer only
    useSpecificationStore.getState().updateInMemory(specId, { name: value })
  }

  const handleDescriptionChange = (value: string) => {
    useSpecificationStore.getState().updateInMemory(specId, { description: value || null })
  }

  const handleVersionBump = async (newVersion: string, reason?: string) => {
    // Server first: batch-save deliberately drops `version` on update, so an
    // in-memory-only bump never reaches the row and exports keep the old number.
    try {
      await updateSpecificationVersion(specId, newVersion)
    } catch (err) {
      toast.error(bumpErrorMessage(err, newVersion))
      return
    }
    const entry = createVersionEntry(newVersion, userName, reason)
    const currentHistory = parseVersionHistory(data.versionHistory)
    const updatedHistory = [entry, ...currentHistory]
    useSpecificationStore.getState().updateInMemory(specId, {
      version: newVersion,
      data: { ...readActionData(specId), versionHistory: JSON.stringify(updatedHistory) },
    })
  }

  // spec.data patch helper — shallow merge through specStore.
  const patchData = (patch: Partial<ActionData>) => {
    useSpecificationStore.getState().updateSpecData(specId, patch)
  }

  // Save / discard / close
  // Returns false when the save failed; the global SaveErrorToast tells the user.
  const handleSave = async (): Promise<boolean> => {
    try {
      await flushNow()
      return true
    } catch (err) {
      console.error('Save failed:', err)
      return false
    }
  }

  const handleDiscard = () => {
    if (!confirm('Discard all unsaved changes to this action?')) return
    useSpecificationStore.getState().discardLocalEdits([specId], { confirmedByUser: true })
  }

  const handleClose = async () => {
    // Always flush: a save still in flight must finish (and succeed) before closing.
    if (!(await handleSave())) return
    setSelectedSpecification(null)
  }

  return (
    <div className="flex-1 bg-slate-50 dark:bg-slate-900 flex flex-col">
      {/* Sticky header */}
      <div className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-3 pt-3 pb-2 shrink-0">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
              <Zap className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200">Action Details</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
                Define action parameters and values
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <VersionBadge version={specVersion} onBump={handleVersionBump} disabled={!canEdit} />
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowVersionHistory(true)}
              title="Show version history"
            >
              <History className="h-4 w-4" />
              History
            </Button>
            {library && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => exportSingleAction(selectedSpec, library)}
                title="Export this action"
              >
                <Download className="h-4 w-4" />
                Export
              </Button>
            )}
            {isDirty && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleDiscard}
                title="Revert all unsaved changes to this action"
              >
                <X className="h-4 w-4" />
                Discard
              </Button>
            )}
            <SaveStatusButton
              isDirty={isDirty}
              lastSaveError={lastSaveError}
              onSave={async () => {
                await handleSave()
              }}
              tooltip="Save action"
            />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleClose} title="Close (saves first)">
              Close
            </Button>
          </div>
        </div>
      </div>

      {/* Scrollable form */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-3">
          <fieldset disabled={!canEdit} className="contents">
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              {/* Basic Info Section */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">Basic Information</h3>
                  <div className="flex items-center gap-1 rounded-md border border-slate-200 p-0.5">
                    <button
                      type="button"
                      className={`px-2.5 py-0.5 text-xs font-medium rounded transition-colors ${
                        actionVisibility === 'opaque'
                          ? 'bg-slate-700 text-white'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                      onClick={() => patchData({ actionVisibility: 'opaque' })}
                    >
                      Opaque
                    </button>
                    <button
                      type="button"
                      className={`px-2.5 py-0.5 text-xs font-medium rounded transition-colors ${
                        actionVisibility === 'observable'
                          ? 'bg-slate-700 text-white'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                      onClick={() => patchData({ actionVisibility: 'observable' })}
                    >
                      Observable
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-sm">Name</Label>
                    <Input
                      value={nameBuffer}
                      onChange={(e) => handleNameChange(e.target.value)}
                      placeholder="Action name"
                    />
                    {nameInvalid && <p className="text-xs text-red-500">Name is required</p>}
                  </div>

                  <div className="space-y-1">
                    <Label className="text-sm">Description</Label>
                    <Textarea
                      value={description}
                      onChange={(e) => handleDescriptionChange(e.target.value)}
                      placeholder="Describe what this action does..."
                      className="min-h-[60px]"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-sm">OID</Label>
                    <p className="text-xs font-mono text-slate-500 dark:text-slate-400 break-all select-all">
                      {selectedSpec.id}
                    </p>
                  </div>
                </div>
              </div>

              {/* Input Parameters Section */}
              <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Input Parameters</h3>
                <ValuesEditor
                  values={inputs}
                  onChange={(newInputs) => patchData({ inputs: newInputs })}
                  label="Input Parameters"
                  namePlaceholder="Parameter Name"
                  emptyMessage="No input parameters"
                />
              </div>

              {/* Output Parameters Section */}
              <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Output Parameters</h3>
                <ValuesEditor
                  values={outputs}
                  onChange={(newOutputs) => patchData({ outputs: newOutputs })}
                  label="Output Parameters"
                  namePlaceholder="Parameter Name"
                  emptyMessage="No output parameters"
                />
              </div>
            </div>
          </fieldset>
        </div>
      </div>
      <VersionHistoryDialog
        open={showVersionHistory}
        onOpenChange={setShowVersionHistory}
        history={specVersionHistory}
      />
    </div>
  )
}
