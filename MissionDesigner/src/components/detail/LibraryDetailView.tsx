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

import { libraryLabel } from '@/lib/global-team'
import { Library, Server, X } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { Textarea } from '@mission/ui'
import { Button } from '@mission/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { updateLibraryInMemory, flushLibrariesNow, discardLibraryEdits } from '@/stores/specificationStore/libraryCrud'
import { VersionBadge } from '@/components/version'
import { useUserName } from '@/stores/principalStore'
import { createVersionEntry, parseVersionHistory } from '@/types/version'
import type { VersionHistoryEntry } from '@/types/version'
import { SaveStatusButton } from '@/components/toolbar/SaveStatusButton'

/**
 * Form-based detail view for editing library metadata.
 *
 * Edits write through to specificationStore on every change (mirrors the
 * spec-side env/action detail views and the workflow canvas pattern). The
 * debounced library flush pushes the patch to the server in the background;
 * the save status button drives a manual flush. Discard reverts to the pre-
 * edit snapshot captured the first time the user touched this library since
 * its last server save.
 */
export function LibraryDetailView() {
  const selectedLibraryId = useLibraryStore((s) => s.selectedLibraryId)
  const libraries = useLibraryStore((s) => s.libraries)
  const childLibraries = useLibraryStore((s) => s.childLibraries)
  const setSelectedLibrary = useLibraryStore((s) => s.setSelectedLibrary)

  // Read library state from specificationStore so writes through
  // updateLibraryInMemory are visible immediately. Falls back to the
  // libraryStore cache for the side-tree views that still feed it.
  const liveLibrary = useSpecificationStore((s) => (selectedLibraryId ? s.libraries.get(selectedLibraryId) : undefined))
  const fallbackLibrary = (() => {
    if (!selectedLibraryId) return null
    const topLevel = libraries.find((lib) => lib.id === selectedLibraryId)
    if (topLevel) return topLevel
    for (const children of childLibraries.values()) {
      const child = children.find((lib) => lib.id === selectedLibraryId)
      if (child) return child
    }
    return null
  })()
  const selectedLibrary = liveLibrary ?? fallbackLibrary

  // Dirty / save state from the store.
  const isDirty = useSpecificationStore((s) => (selectedLibraryId ? s.librariesDirty.has(selectedLibraryId) : false))
  const lastSaveError = useSpecificationStore((s) => s.lastLibrarySaveError)

  const userName = useUserName()

  if (!selectedLibraryId || !selectedLibrary) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="text-center">
          <Library className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 dark:text-slate-400">Select a library to view details</p>
        </div>
      </div>
    )
  }

  const libId = selectedLibraryId

  // Reads come straight from the live store record.
  const description = selectedLibrary.description ?? ''
  const author = selectedLibrary.author ?? ''
  const changeHistory = selectedLibrary.changeHistory ?? ''
  const version = selectedLibrary.version || '1.0.0'
  const environmentLibraryIds = selectedLibrary.environmentLibraryIds || []

  const environmentLibraries = libraries.filter((lib) => lib.entityType === 'environment')
  const showEnvironmentAssociation = selectedLibrary.entityType === 'workflow' || selectedLibrary.entityType === 'step'
  const availableEnvironments = environmentLibraries.filter((lib) => !environmentLibraryIds.includes(lib.id))

  // Field handlers — every change writes through to specStore immediately.
  const handleDescriptionChange = (value: string) => {
    updateLibraryInMemory(libId, { description: value || null })
  }

  const handleAuthorChange = (value: string) => {
    updateLibraryInMemory(libId, { author: value || null })
  }

  const handleAddEnvironment = (envLibraryId: string) => {
    if (!envLibraryId || environmentLibraryIds.includes(envLibraryId)) return
    updateLibraryInMemory(libId, { environmentLibraryIds: [...environmentLibraryIds, envLibraryId] })
  }

  const handleRemoveEnvironment = (envLibraryId: string) => {
    updateLibraryInMemory(libId, {
      environmentLibraryIds: environmentLibraryIds.filter((id) => id !== envLibraryId),
    })
  }

  const handleVersionBump = (newVersion: string, reason?: string) => {
    const entry = createVersionEntry(newVersion, userName, reason)
    const currentHistory = parseVersionHistory(changeHistory)
    const updatedHistory = [entry, ...currentHistory]
    updateLibraryInMemory(libId, {
      version: newVersion,
      changeHistory: JSON.stringify(updatedHistory),
    })
  }

  const handleSave = async () => {
    try {
      await flushLibrariesNow()
    } catch (err) {
      console.error('Library save failed:', err)
      toast.error('Failed to save library')
    }
  }

  const handleDiscard = () => {
    if (!confirm('Discard all unsaved changes to this library?')) return
    discardLibraryEdits(libId, { confirmedByUser: true })
  }

  const handleClose = async () => {
    if (isDirty) await handleSave()
    setSelectedLibrary(null)
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="h-12 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Library className="h-5 w-5 text-blue-500" />
          <span className="font-medium text-slate-700 dark:text-slate-200">{selectedLibrary.name}</span>
        </div>
        <VersionBadge version={version} onBump={handleVersionBump} />
        <div className="flex items-center gap-2">
          {isDirty && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleDiscard}
              title="Revert all unsaved changes to this library"
            >
              <X className="h-4 w-4" />
              Discard
            </Button>
          )}
          <SaveStatusButton
            isDirty={isDirty}
            lastSaveError={lastSaveError}
            onSave={handleSave}
            tooltip="Save library"
          />
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleClose} title="Close (saves first)">
            Close
          </Button>
        </div>
      </div>

      {/* Form Content */}
      <div className="flex-1 overflow-auto p-6">
        <div data-testid="library-detail-view" className="max-w-2xl space-y-6">
          {/* Library Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Library Description
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              placeholder="Describe the purpose and contents of this library..."
              className="min-h-[120px] resize-y"
            />
          </div>

          {/* Environment Libraries (only for workflow and step libraries) */}
          {showEnvironmentAssociation && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Associated Environment Libraries
              </Label>
              <p className="text-xs text-slate-500">
                Select environment libraries that provide context for this {selectedLibrary.entityType}.
              </p>

              {/* Selected environments */}
              {environmentLibraryIds.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {environmentLibraryIds.map((envId) => {
                    const envLib = libraries.find((lib) => lib.id === envId)
                    return (
                      <div
                        key={envId}
                        className="flex items-center gap-1 px-2 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 rounded-md text-sm"
                      >
                        <Server className="h-3 w-3" />
                        <span>{envLib?.name || 'Unknown'}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveEnvironment(envId)}
                          className="ml-1 hover:text-emerald-600"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Add environment dropdown */}
              {availableEnvironments.length > 0 ? (
                <Select onValueChange={handleAddEnvironment} value="">
                  <SelectTrigger className="w-full max-w-md">
                    <SelectValue placeholder="Add environment library..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableEnvironments.map((envLib) => (
                      <SelectItem key={envLib.id} value={envLib.id}>
                        <div className="flex items-center gap-2">
                          <Server className="h-4 w-4 text-emerald-600" />
                          {libraryLabel(envLib)}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : environmentLibraryIds.length === 0 ? (
                <p className="text-sm text-slate-400 italic">
                  No environment libraries available. Create one in the Environment tab.
                </p>
              ) : (
                <p className="text-sm text-slate-400 italic">All environment libraries have been added.</p>
              )}
            </div>
          )}

          {/* Author */}
          <div className="space-y-2">
            <Label htmlFor="author" className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Author
            </Label>
            <Input
              id="author"
              value={author}
              onChange={(e) => handleAuthorChange(e.target.value)}
              placeholder="Author name"
              className="max-w-md"
            />
          </div>

          {/* Version History */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700 dark:text-slate-200">Version History</Label>
            {(() => {
              const history = parseVersionHistory(changeHistory)
              if (history.length === 0) {
                return <p className="text-sm text-muted-foreground">No version history</p>
              }
              return (
                <div className="max-h-[200px] overflow-y-auto border rounded-md p-2 text-sm font-mono space-y-1">
                  {history.map((entry: VersionHistoryEntry, i: number) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <span className="font-semibold shrink-0">{entry.version}</span>
                      <span className="text-muted-foreground shrink-0">
                        {new Date(entry.date).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="text-muted-foreground shrink-0">{entry.account}</span>
                      {entry.reason && <span className="truncate">{entry.reason}</span>}
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}
