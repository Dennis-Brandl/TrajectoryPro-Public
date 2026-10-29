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

import { librariesForNames } from '@/lib/global-team'
import { useEffect, useState } from 'react'
import { Server, X, Download, History } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { Button } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { flushNow } from '@/stores/specificationStore/saveScheduler'
import { exportSingleEnvironment } from '@/lib/export'
import { useSpecificationById } from '@/hooks/useSpecificationById'
import { createDefaultEntries } from '@/lib/value-utils'
import type { ResourceSpec, ValueSpec, ActionServerSpec, ValueTypeSpec } from '@/types/nodes'
import { IncludedActionsSection } from './environment/IncludedActionsSection'
import type { IncludedAction } from './environment/IncludedActionsSection'
import { PropertyValuesSection } from './environment/PropertyValuesSection'
import { ValueTypesSection } from './environment/ValueTypesSection'
import { ResourcesSection } from './environment/ResourcesSection'
import { ActionServersSection } from './environment/ActionServersSection'
import { useUserName } from '@/stores/principalStore'
import { useCanEditActiveSpec } from '@/hooks/useCanEditActiveSpec'
import { VersionBadge, VersionHistoryDialog } from '@/components/version'
import { createVersionEntry, parseVersionHistory } from '@/types/version'
import { bumpErrorMessage, updateSpecificationVersion } from '@/lib/api/specification-mutations'
import { SaveStatusButton } from '@/components/toolbar/SaveStatusButton'

interface EnvironmentData {
  included_actions?: IncludedAction[]
  resources?: ResourceSpec[]
  values?: ValueSpec[]
  actionProperties?: ValueSpec[]
  actionServers?: ActionServerSpec[]
  valueTypes?: ValueTypeSpec[]
  versionHistory?: string
}

type TabKey = 'actions' | 'values' | 'actionProps' | 'valueTypes' | 'resources' | 'servers'

const TAB_LABELS: Record<TabKey, string> = {
  actions: 'Included Actions',
  values: 'Property Values',
  actionProps: 'Action Properties',
  valueTypes: 'Value Types',
  resources: 'Resources',
  servers: 'Registered Action Servers',
}

/**
 * Migrate legacy flat values ({name, value, description}) to ValueSpec with entries.
 * Pure — caller decides whether to persist the migrated form.
 */
function migrateValues(rawValues: unknown[]): ValueSpec[] {
  return (rawValues as Array<ValueSpec & { value?: string; description?: string }>).map((v) => {
    if (v.entries) return v as ValueSpec
    const entries = createDefaultEntries()
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

/**
 * Read the current EnvironmentData for a spec from the store.
 * Returns an empty object if the spec is not present (defensive).
 */
function readEnvData(specId: string): EnvironmentData {
  const spec = useSpecificationStore.getState().specs.get(specId)
  return ((spec?.data as EnvironmentData) ?? {}) as EnvironmentData
}

/**
 * Form-based detail view for editing environment specifications.
 *
 * Edits write through to specificationStore on every change, mirroring the
 * workflow canvas pattern. The save status button drives an explicit/manual
 * server flush; the debounced auto-flush (`scheduleFlush`) runs in the
 * background regardless. Discard reverts to the pre-edit snapshot captured
 * the first time the user touched this spec since its last server save.
 */
export function EnvironmentDetailView() {
  const selectedSpecificationId = useLibraryStore((s) => s.selectedSpecificationId)
  const selectedLibraryId = useLibraryStore((s) => s.selectedLibraryId)
  const allLibraries = useLibraryStore((s) => s.libraries)
  const setSelectedSpecification = useLibraryStore((s) => s.setSelectedSpecification)
  const { spec: selectedSpec } = useSpecificationById(selectedSpecificationId)
  const library = allLibraries.find((l) => l.id === selectedLibraryId)

  // Dirty / save state from the store — same source the canvas toolbar reads.
  const isDirty = useSpecificationStore((s) =>
    selectedSpecificationId ? s.dirtyIds.has(selectedSpecificationId) : false,
  )
  const lastSaveError = useSpecificationStore((s) => s.lastSaveError)

  // The only local buffer we keep is for the `name` field, because empty/
  // whitespace names are invalid and must not write through to the store
  // (server would reject; user gets a confusing error). All other fields
  // write through unconditionally on every change.
  const [nameBuffer, setNameBuffer] = useState('')

  // UI-only state — not part of the spec data.
  const [activeTab, setActiveTab] = useState<TabKey>('actions')
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

  // One-shot legacy-value migration when a spec with the old flat shape is
  // first loaded into the view. Persists the migration via the same write-
  // through path everything else uses.
  useEffect(() => {
    if (!selectedSpec) return
    const data = (selectedSpec.data as EnvironmentData) ?? {}
    const rawValues = data.values ?? []
    const rawActionProps = data.actionProperties ?? []
    const needsMigration = rawValues.some((v) => !v.entries) || rawActionProps.some((v) => !v.entries)
    if (!needsMigration) return
    useSpecificationStore.getState().updateSpecData(selectedSpec.id, {
      values: migrateValues(rawValues),
      actionProperties: migrateValues(rawActionProps),
    })
  }, [selectedSpec?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedSpecificationId || !selectedSpec) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="text-center">
          <Server className="h-12 w-12 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-500 dark:text-slate-400">Select an environment from the library</p>
          <p className="text-sm text-slate-400 mt-1">
            Choose an environment specification to view and edit its details
          </p>
        </div>
      </div>
    )
  }

  const specId = selectedSpecificationId
  const data = (selectedSpec.data as EnvironmentData) ?? {}
  const includedActions = data.included_actions ?? []
  const resources = data.resources ?? []
  const values = data.values ?? []
  const actionProperties = data.actionProperties ?? []
  const actionServers = data.actionServers ?? []
  const valueTypes = data.valueTypes ?? []
  const description = selectedSpec.description ?? ''
  const specVersion = selectedSpec.version || '1.0.0'
  const specVersionHistory = parseVersionHistory(data.versionHistory)

  // Validation gate: don't write empty/whitespace names through to the store.
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
      data: { ...readEnvData(specId), versionHistory: JSON.stringify(updatedHistory) },
    })
  }

  // Data-section handlers — each reads fresh data via getState() to avoid
  // stale closures, then writes a single shallow patch through updateSpecData.
  const patchData = (patch: Partial<EnvironmentData>) => {
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
    if (!confirm('Discard all unsaved changes to this environment?')) return
    useSpecificationStore.getState().discardLocalEdits([specId], { confirmedByUser: true })
  }

  const handleClose = async () => {
    // Always flush: a save still in flight must finish (and succeed) before closing.
    if (!(await handleSave())) return
    setSelectedSpecification(null)
  }

  // Tab counts for badges
  const tabCounts: Record<TabKey, number> = {
    actions: includedActions.length,
    values: values.length,
    actionProps: actionProperties.length,
    valueTypes: valueTypes.length,
    resources: resources.length,
    servers: actionServers.length,
  }

  return (
    <div className="flex-1 bg-slate-50 dark:bg-slate-900 flex flex-col">
      {/* Sticky header */}
      <div className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-3 pt-3 pb-2 shrink-0">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Server className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200">Environment Details</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Configure the actions, properties, resources, and servers for this environment
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
                onClick={async () => {
                  const toastId = toast.loading('Exporting environment package...')
                  try {
                    // Make WFenvirX self-contained: ensure specs for every
                    // action library referenced by this env spec are loaded
                    // into the store before bundling. Otherwise the packager
                    // sees an empty spec list for those libs and writes an
                    // empty actions/{name}.WFaction.
                    const referencedActionLibNames = new Set<string>()
                    for (const a of includedActions) {
                      if (a.action_library) referencedActionLibNames.add(a.action_library)
                    }
                    // Only the library each name resolves to (spec 2026-10-12 U4), not every namesake.
                    const refActionLibs = librariesForNames(
                      allLibraries,
                      referencedActionLibNames,
                      'action',
                      library.teamId,
                    )
                    for (const lib of refActionLibs) {
                      if (!useLibraryStore.getState().specifications.has(lib.id)) {
                        await useLibraryStore.getState().fetchSpecifications(lib.id)
                      }
                    }
                    const freshSpecsByLibrary = useLibraryStore.getState().specifications
                    const filename = await exportSingleEnvironment(
                      selectedSpec,
                      library,
                      allLibraries,
                      freshSpecsByLibrary,
                    )
                    toast.success(`Downloaded ${filename}`, { id: toastId, duration: 4000 })
                  } catch (error) {
                    toast.error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
                      id: toastId,
                      duration: Infinity,
                    })
                  }
                }}
                title="Export this environment as a .WFenvirX package"
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
                title="Revert all unsaved changes to this environment"
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
              tooltip="Save environment"
            />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleClose} title="Close (saves first)">
              Close
            </Button>
          </div>
        </div>
      </div>

      {/* Scrollable form */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-3">
          <fieldset disabled={!canEdit} className="contents">
            <div className="space-y-3">
              {/* Basic Info — always visible */}
              <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Basic Information</h3>
                <div className="grid grid-cols-[1fr_2fr] gap-3">
                  <div className="space-y-1">
                    <Label className="text-sm">Name</Label>
                    <Input
                      value={nameBuffer}
                      onChange={(e) => handleNameChange(e.target.value)}
                      placeholder="Environment name"
                    />
                    {nameInvalid && <p className="text-xs text-red-500">Name is required</p>}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm">Description</Label>
                    <Input
                      value={description}
                      onChange={(e) => handleDescriptionChange(e.target.value)}
                      placeholder="Describe this environment..."
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-sm">OID</Label>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400 break-all select-all">
                    {selectedSpec.id}
                  </p>
                </div>
              </div>

              {/* Tabbed sections */}
              <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                {/* Tab bar */}
                <div role="tablist" className="flex border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
                  {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === key}
                      tabIndex={activeTab === key ? 0 : -1}
                      onClick={() => setActiveTab(key)}
                      className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                        activeTab === key
                          ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                          : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      {TAB_LABELS[key]}
                      {tabCounts[key] > 0 && (
                        <span className="ml-1.5 text-xs font-normal bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-full">
                          {tabCounts[key]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <div role="tabpanel" className="p-3">
                  {activeTab === 'actions' && (
                    <IncludedActionsSection
                      includedActions={includedActions}
                      onAdd={(action) =>
                        patchData({ included_actions: [...(readEnvData(specId).included_actions ?? []), action] })
                      }
                      onAddAll={(actions) =>
                        patchData({ included_actions: [...(readEnvData(specId).included_actions ?? []), ...actions] })
                      }
                      onRemove={(index) =>
                        patchData({
                          included_actions: (readEnvData(specId).included_actions ?? []).filter((_, i) => i !== index),
                        })
                      }
                      hideHeader
                      environmentTeamId={library?.teamId}
                    />
                  )}

                  {activeTab === 'values' && (
                    <PropertyValuesSection
                      values={values}
                      actionProperties={[]}
                      onValuesChange={(newValues) => patchData({ values: newValues })}
                      onActionPropertiesChange={() => {}}
                      hideHeaders
                      showValuesOnly
                      availableValueTypes={valueTypes}
                    />
                  )}

                  {activeTab === 'actionProps' && (
                    <PropertyValuesSection
                      values={[]}
                      actionProperties={actionProperties}
                      onValuesChange={() => {}}
                      onActionPropertiesChange={(newValues) => patchData({ actionProperties: newValues })}
                      hideHeaders
                      showActionPropertiesOnly
                      availableValueTypes={valueTypes}
                    />
                  )}

                  {activeTab === 'valueTypes' && (
                    <ValueTypesSection
                      valueTypes={valueTypes}
                      onAdd={(vt) => patchData({ valueTypes: [...(readEnvData(specId).valueTypes ?? []), vt] })}
                      onRemove={(id) =>
                        patchData({ valueTypes: (readEnvData(specId).valueTypes ?? []).filter((v) => v.id !== id) })
                      }
                      onUpdate={(id, updates) =>
                        patchData({
                          valueTypes: (readEnvData(specId).valueTypes ?? []).map((v) =>
                            v.id === id ? { ...v, ...updates } : v,
                          ),
                        })
                      }
                      hideHeader
                    />
                  )}

                  {activeTab === 'resources' && (
                    <ResourcesSection
                      resources={resources}
                      onAdd={(resource) =>
                        patchData({ resources: [...(readEnvData(specId).resources ?? []), resource] })
                      }
                      onRemove={(id) =>
                        patchData({ resources: (readEnvData(specId).resources ?? []).filter((r) => r.id !== id) })
                      }
                      onUpdate={(id, updates) => {
                        const current = readEnvData(specId).resources ?? []
                        const next = current.map((r) => {
                          if (r.id !== id) return r
                          const updated = { ...r, ...updates }
                          if (updated.resourceType === 'Single Use' || updated.resourceType === 'Sync') {
                            updated.count = 1
                            updated.names = undefined
                          } else if (updated.resourceType === 'Named') {
                            if (!updated.names) updated.names = []
                            updated.count = updated.names.length
                          } else {
                            updated.names = undefined
                          }
                          return updated
                        })
                        patchData({ resources: next })
                      }}
                      hideHeader
                    />
                  )}

                  {activeTab === 'servers' && (
                    <ActionServersSection
                      actionServers={actionServers}
                      onAdd={(server) =>
                        patchData({ actionServers: [...(readEnvData(specId).actionServers ?? []), server] })
                      }
                      onRemove={(id) =>
                        patchData({
                          actionServers: (readEnvData(specId).actionServers ?? []).filter((s) => s.id !== id),
                        })
                      }
                      onUpdate={(id, updates) =>
                        patchData({
                          actionServers: (readEnvData(specId).actionServers ?? []).map((s) =>
                            s.id === id ? { ...s, ...updates } : s,
                          ),
                        })
                      }
                      hideHeader
                    />
                  )}
                </div>
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
