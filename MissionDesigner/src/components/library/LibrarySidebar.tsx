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
import { Workflow, Cog, Server, Zap, X } from 'lucide-react'
import { cn } from '@mission/ui'
import { useLibraryStore } from '@/stores/libraryStore'
import { SearchInput } from './SearchInput'
import { LibraryTree } from './LibraryTree'
import { CreateLibraryDialog } from './CreateLibraryDialog'
import { StateFilterControl } from './StateFilterControl'
import { TeamFilterDropdown } from './TeamFilterDropdown'
import { ExportMenu, ImportButton } from '@/components/export'
import { LegacyFormatDialog } from '@/components/import/LegacyFormatDialog'
import { ImportConflictDialog } from '@/components/import/ImportConflictDialog'
import { ImportWarningsDialog } from '@/components/import/ImportWarningsDialog'
import { ImportErrorDialog } from '@/components/import/ImportErrorDialog'
import { WorkflowLibraryImportDialog } from '@/components/import/WorkflowLibraryImportDialog'
import { mayImportLibraryInto } from '@/components/library/global-import-guard'
import { PostImportReportDialog } from '@/components/import/PostImportReportDialog'
import type { EntityType } from '@/types/library'
import type { ImportPlan, PostImportReport } from '@/types/wflibx-import'
import { useLibraryExport } from './use-library-export'
import { useLibraryImport, type ConflictDialogState, type WarningsDialogState } from './use-library-import'
import { usePrincipal, principalHasRightInAnyTeam } from '@/stores/principalStore'
import { categoryForEntityType } from '@/lib/lifecycle'

interface TabItem {
  type: EntityType
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const tabs: TabItem[] = [
  { type: 'workflow', label: 'Workflows', icon: Workflow },
  { type: 'step', label: 'Steps', icon: Cog },
  { type: 'environment', label: 'Environments', icon: Server },
  { type: 'action', label: 'Actions', icon: Zap },
]

interface LibrarySidebarProps {
  width?: number
  collapsed?: boolean
}

/**
 * Main library sidebar component.
 * Shows entity type tabs, search input, library tree, create button, and export/import controls.
 */
export function LibrarySidebar({ width, collapsed }: LibrarySidebarProps) {
  const principal = usePrincipal()
  const [showLegacyFormatDialog, setShowLegacyFormatDialog] = useState(false)
  const [conflictDialogState, setConflictDialogState] = useState<ConflictDialogState | null>(null)
  const [warningsDialogState, setWarningsDialogState] = useState<WarningsDialogState | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importPlan, setImportPlan] = useState<{
    plan: ImportPlan
    onCommit: (r: Record<string, 'keep' | 'replace'>, teamId: string) => Promise<void>
  } | null>(null)
  const [postImportReport, setPostImportReport] = useState<PostImportReport | null>(null)
  const activeEntityType = useLibraryStore((s) => s.activeEntityType)
  const setActiveEntityType = useLibraryStore((s) => s.setActiveEntityType)
  const isLoading = useLibraryStore((s) => s.isLoading)
  const error = useLibraryStore((s) => s.error)
  const clearError = useLibraryStore((s) => s.clearError)
  const selectedTeamId = useLibraryStore((s) => s.selectedTeamId)
  const selectedLibraryId = useLibraryStore((s) => s.selectedLibraryId)

  // Read requires no right (design §3): every member/admin sees all entity-type
  // tabs and browses libraries read-only. Affordances inside are right-gated.
  const visibleTabs = tabs

  const { handleExportLibrary, handleExportPDF, handleExportSpecPDF, handleExportSpecPackage } = useLibraryExport()
  const {
    handleImportResult,
    handleImportError,
    handleRuntimePackageImport,
    handleWorkflowLibraryPackageImport,
    handleLibraryPackageImport,
    handleSingleSpecImport,
    handleBatchmlImport,
  } = useLibraryImport(
    setShowLegacyFormatDialog,
    setConflictDialogState,
    setWarningsDialogState,
    setImportError,
    setImportPlan,
    setPostImportReport,
  )

  // Collapsed icon rail view
  if (collapsed) {
    return (
      <div
        className="bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col h-full shrink-0"
        style={{ width: 48 }}
      >
        {/* Legacy format rejection dialog */}
        <LegacyFormatDialog open={showLegacyFormatDialog} onClose={() => setShowLegacyFormatDialog(false)} />

        {/* Import conflict dialog */}
        {conflictDialogState && (
          <ImportConflictDialog
            open={conflictDialogState.open}
            importedName={conflictDialogState.importedName}
            importedVersion={conflictDialogState.importedVersion}
            existingVersion={conflictDialogState.existingVersion}
            onResolve={conflictDialogState.onResolve}
            onCancel={conflictDialogState.onCancel}
          />
        )}

        {/* Import warnings dialog */}
        {warningsDialogState && (
          <ImportWarningsDialog
            open={warningsDialogState.open}
            workflowName={warningsDialogState.workflowName}
            unresolvedProxies={warningsDialogState.unresolvedProxies}
            onClose={() => {
              useLibraryStore
                .getState()
                .setSelectedSpecification(warningsDialogState.specificationId, warningsDialogState.libraryId)
              setWarningsDialogState(null)
            }}
          />
        )}

        {/* Import error dialog */}
        <ImportErrorDialog
          open={importError !== null}
          errorMessage={importError ?? ''}
          onClose={() => setImportError(null)}
        />

        {/* Workflow library import plan dialog */}
        {importPlan && (
          <WorkflowLibraryImportDialog
            open
            plan={importPlan.plan}
            onCommit={async (resolutions, teamId) => {
              try {
                await importPlan.onCommit(resolutions, teamId)
              } finally {
                setImportPlan(null)
              }
            }}
            onCancel={() => setImportPlan(null)}
          />
        )}

        {/* Post-import report dialog */}
        {postImportReport && (
          <PostImportReportDialog open report={postImportReport} onClose={() => setPostImportReport(null)} />
        )}

        {/* Collapsed header spacer */}
        <div className="h-12 border-b border-slate-200 dark:border-slate-700" />

        {/* Entity type icons stacked vertically */}
        <div className="flex flex-col items-center py-2 gap-1">
          {tabs.map(({ type, label, icon: Icon }) => (
            <button
              key={type}
              onClick={() => setActiveEntityType(type)}
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded transition-colors',
                activeEntityType === type
                  ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800',
              )}
              title={label}
            >
              <Icon className="h-5 w-5" />
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className="bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col h-full shrink-0"
      style={{ width: width ?? 256 }}
    >
      {/* Legacy format rejection dialog */}
      <LegacyFormatDialog open={showLegacyFormatDialog} onClose={() => setShowLegacyFormatDialog(false)} />

      {/* Import conflict dialog */}
      {conflictDialogState && (
        <ImportConflictDialog
          open={conflictDialogState.open}
          importedName={conflictDialogState.importedName}
          importedVersion={conflictDialogState.importedVersion}
          existingVersion={conflictDialogState.existingVersion}
          onResolve={conflictDialogState.onResolve}
          onCancel={conflictDialogState.onCancel}
        />
      )}

      {/* Import warnings dialog */}
      {warningsDialogState && (
        <ImportWarningsDialog
          open={warningsDialogState.open}
          workflowName={warningsDialogState.workflowName}
          unresolvedProxies={warningsDialogState.unresolvedProxies}
          onClose={() => {
            useLibraryStore
              .getState()
              .setSelectedSpecification(warningsDialogState.specificationId, warningsDialogState.libraryId)
            setWarningsDialogState(null)
          }}
        />
      )}

      {/* Import error dialog */}
      <ImportErrorDialog
        open={importError !== null}
        errorMessage={importError ?? ''}
        onClose={() => setImportError(null)}
      />

      {/* Workflow library import plan dialog */}
      {importPlan && (
        <WorkflowLibraryImportDialog
          open
          plan={importPlan.plan}
          onCommit={async (resolutions, teamId) => {
            try {
              await importPlan.onCommit(resolutions, teamId)
            } finally {
              setImportPlan(null)
            }
          }}
          onCancel={() => setImportPlan(null)}
        />
      )}

      {/* Post-import report dialog */}
      {postImportReport && (
        <PostImportReportDialog open report={postImportReport} onClose={() => setPostImportReport(null)} />
      )}

      {/* Header with title */}
      <div className="h-12 border-b border-slate-200 dark:border-slate-700 flex items-center px-4">
        <span className="font-medium text-slate-700 dark:text-slate-200">Libraries</span>
      </div>

      {/* Entity type tabs */}
      <div
        className="flex border-b border-slate-200 dark:border-slate-700"
        role="tablist"
        aria-label="Library entity types"
      >
        {visibleTabs.map(({ type, label, icon: Icon }) => {
          const isActive = activeEntityType === type
          return (
            <button
              key={type}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveEntityType(type)}
              className={cn(
                'flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors',
                isActive
                  ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50 dark:bg-blue-900/30'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800',
              )}
              title={label}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate max-w-full px-1">{label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab panel content */}
      <div role="tabpanel" aria-label={`${activeEntityType} libraries`} className="flex flex-col flex-1 min-h-0">
        {/* Search input + Create button */}
        <div className="p-2 border-b border-slate-200 dark:border-slate-700 space-y-2">
          <TeamFilterDropdown />
          <SearchInput />
          <div className="flex items-center gap-2">
            <StateFilterControl />
            {principalHasRightInAnyTeam(principal, `${categoryForEntityType(activeEntityType)}:library.create`) && (
              <CreateLibraryDialog />
            )}
          </div>
        </div>

        {/* Export/Import toolbar */}
        <div className="p-2 border-b border-slate-200 dark:border-slate-700 flex gap-2">
          <ExportMenu
            mode="library"
            onExportJSON={handleExportLibrary}
            onExportPDF={handleExportPDF}
            jsonLabel="Export Library Package"
            disabled={!selectedLibraryId}
          />
          {mayImportLibraryInto(principal, selectedTeamId, activeEntityType) && (
            <ImportButton
              mode="library"
              entityType={activeEntityType}
              onImport={handleImportResult}
              onError={handleImportError}
              onPackageImport={(file) => {
                if (file.name.endsWith('.xml') && activeEntityType === 'workflow') {
                  if (!selectedLibraryId) {
                    toast.error('Select a workflow library first')
                    return
                  }
                  void handleBatchmlImport(selectedLibraryId, file)
                  return
                }
                if (activeEntityType === 'workflow') {
                  void handleWorkflowLibraryPackageImport(file)
                } else {
                  void handleLibraryPackageImport(file)
                }
              }}
            />
          )}
        </div>

        {/* Error banner (dismissible) */}
        {error && (
          <div className="mx-2 mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600 flex items-start gap-2">
            <span className="flex-1">{error}</span>
            <button onClick={clearError} className="p-0.5 hover:bg-red-100 rounded" title="Dismiss">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Library tree (scrollable) */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-5 w-5 border-2 border-slate-300 border-t-blue-600 rounded-full" />
            </div>
          ) : (
            <LibraryTree
              onImportRuntimePackage={handleRuntimePackageImport}
              onImportSingleSpec={handleSingleSpecImport}
              onImportBatchml={handleBatchmlImport}
              onExportPDF={handleExportSpecPDF}
              onExportPackage={handleExportSpecPackage}
            />
          )}
        </div>
      </div>
    </div>
  )
}
