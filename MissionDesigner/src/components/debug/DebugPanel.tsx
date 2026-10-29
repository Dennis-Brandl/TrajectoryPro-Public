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

import { useState, useEffect } from 'react'
import { Eye, ChevronRight, ChevronDown, Trash2, RefreshCw } from 'lucide-react'
import { Button } from '@mission/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@mission/ui'
import { cn } from '@mission/ui'

interface WorkflowNode {
  id: string
  type: string
  data: {
    label?: string
    stepType?: string
    subWorkflowMode?: 'embedded' | 'reference'
    embeddedWorkflowSpecId?: string
    [key: string]: unknown
  }
}

interface Specification {
  id: string
  name: string
  description: string | null
  libraryId: string
  data: {
    nodes?: WorkflowNode[]
    parentSpecificationId?: string
    [key: string]: unknown
  } | null
  createdAt: string
  updatedAt: string
}

interface Library {
  id: string
  name: string
  entityType: 'workflow' | 'step' | 'environment' | 'action'
  parentLibraryId: string | null
  userId: string
  createdAt: string
  updatedAt: string
}

interface DebugData {
  libraries: Library[]
  specifications: Specification[]
}

/**
 * Debug panel for viewing and managing all database entities.
 */
export function DebugPanel() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<DebugData | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedLibraries, setExpandedLibraries] = useState<Set<string>>(new Set())
  const [expandedSpecs, setExpandedSpecs] = useState<Set<string>>(new Set())
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(
    new Set(['workflow', 'step', 'environment', 'action']),
  )
  const fetchData = async () => {
    setLoading(true)
    try {
      // Fetch all libraries (v2 API)
      const libResponse = await fetch('/api/v2/libraries', { credentials: 'include' })
      const libData = await libResponse.json()
      const libraries: Library[] = libData.libraries || []

      // Fetch specifications for each library (v2 API)
      const specifications: Specification[] = []
      for (const lib of libraries) {
        const specResponse = await fetch(`/api/v2/libraries/${lib.id}/specifications`, { credentials: 'include' })
        const specData = await specResponse.json()
        specifications.push(...(specData.specs || []))
      }

      setData({ libraries, specifications })
      // Auto-expand all libraries
      setExpandedLibraries(new Set(libraries.map((l) => l.id)))
    } catch (error) {
      console.error('Failed to fetch debug data:', error)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (open) {
      fetchData()
    }
  }, [open])

  const handleDeleteLibrary = async (id: string) => {
    if (!confirm('Delete this library? It must be empty (no specs, no child libraries).')) return
    try {
      const resp = await fetch(`/api/v2/libraries/${id}`, { method: 'DELETE', credentials: 'include' })
      if (!resp.ok) {
        const err = await resp.json()
        alert(`Delete failed: ${err.code || resp.statusText}`)
        return
      }
      fetchData()
    } catch (err) {
      alert(`Delete failed: ${err}`)
    }
  }

  const handleDeleteSpec = async (id: string) => {
    if (!confirm('Delete this specification?')) return
    try {
      const { useSpecificationStore } = await import('@/stores/specificationStore')
      useSpecificationStore.getState().deleteSpecInMemory(id)
      const { flushNow } = await import('@/stores/specificationStore/saveScheduler')
      await flushNow()
      fetchData()
    } catch (err) {
      alert(`Delete failed: ${err}`)
    }
  }

  const toggleLibrary = (id: string) => {
    const newExpanded = new Set(expandedLibraries)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedLibraries(newExpanded)
  }

  const toggleType = (type: string) => {
    const newExpanded = new Set(expandedTypes)
    if (newExpanded.has(type)) {
      newExpanded.delete(type)
    } else {
      newExpanded.add(type)
    }
    setExpandedTypes(newExpanded)
  }

  const toggleSpec = (id: string) => {
    const newExpanded = new Set(expandedSpecs)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedSpecs(newExpanded)
  }

  const getLibrariesByType = (type: string) => {
    if (!data) return []
    return data.libraries.filter((l) => l.entityType === type && !l.parentLibraryId)
  }

  const getChildLibraries = (parentId: string) => {
    if (!data) return []
    return data.libraries.filter((l) => l.parentLibraryId === parentId)
  }

  const getSpecsForLibrary = (libraryId: string) => {
    if (!data) return []
    return data.specifications.filter((s) => s.libraryId === libraryId)
  }

  const getSpecById = (specId: string) => {
    if (!data) return null
    return data.specifications.find((s) => s.id === specId) || null
  }

  const getNodeTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      start: 'Start',
      end: 'End',
      actionProxyWait: 'Env Action',
      workflowProxy: 'Child Workflow',
      select1: 'Select 1',
      waitAny: 'Wait Any',
      parallel: 'Parallel',
      waitAll: 'Wait All',
    }
    return labels[type] || type
  }

  const renderLibrary = (lib: Library, depth: number = 0): React.ReactNode => {
    const specs = getSpecsForLibrary(lib.id)
    const children = getChildLibraries(lib.id)
    const isExpanded = expandedLibraries.has(lib.id)
    const hasContent = specs.length > 0 || children.length > 0

    return (
      <div key={lib.id} style={{ marginLeft: depth * 16 }}>
        <div className="flex items-center gap-1 py-0.5 hover:bg-slate-100 rounded group">
          <button onClick={() => toggleLibrary(lib.id)} className="p-0.5" disabled={!hasContent}>
            {hasContent ? (
              isExpanded ? (
                <ChevronDown className="h-3 w-3 text-slate-400" />
              ) : (
                <ChevronRight className="h-3 w-3 text-slate-400" />
              )
            ) : (
              <span className="w-3" />
            )}
          </button>
          <span className="text-sm font-medium text-slate-700">{lib.name}</span>
          <code className="text-[9px] text-slate-400 font-mono bg-slate-50 px-1 rounded" title={lib.id}>
            {lib.id.slice(0, 8)}
          </code>
          <span className="flex-1" />
          <span className="text-xs text-slate-400 mr-2">
            {specs.length} spec{specs.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => handleDeleteLibrary(lib.id)}
            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-100 rounded text-red-500"
            title="Delete library"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {isExpanded && (
          <div className="ml-4">
            {specs.map((spec) => {
              const parentId = spec.data?.parentSpecificationId
              const nodes = spec.data?.nodes || []
              const isSpecExpanded = expandedSpecs.has(spec.id)
              const hasNodes = nodes.length > 0

              return (
                <div key={spec.id}>
                  <div className="flex items-center gap-1 py-0.5 hover:bg-slate-50 rounded group text-sm">
                    <button onClick={() => toggleSpec(spec.id)} className="p-0.5" disabled={!hasNodes}>
                      {hasNodes ? (
                        isSpecExpanded ? (
                          <ChevronDown className="h-3 w-3 text-slate-400" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-slate-400" />
                        )
                      ) : (
                        <span className="w-3" />
                      )}
                    </button>
                    <span className="text-slate-600 truncate" title={spec.id}>
                      {spec.name}
                    </span>
                    <code className="text-[9px] text-slate-400 font-mono bg-slate-50 px-1 rounded" title={spec.id}>
                      {spec.id.slice(0, 8)}
                    </code>
                    {parentId && <span className="text-xs text-slate-400">(child)</span>}
                    {hasNodes && <span className="text-xs text-slate-400">[{nodes.length} steps]</span>}
                    <span className="flex-1" />
                    <button
                      onClick={() => handleDeleteSpec(spec.id)}
                      className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-100 rounded text-red-500"
                      title="Delete specification"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {isSpecExpanded && hasNodes && (
                    <div className="ml-6 border-l border-slate-200 pl-2">
                      {nodes.map((node, idx) => {
                        const isChildWorkflow = node.type === 'workflowProxy'
                        const embeddedSpec =
                          isChildWorkflow && node.data.embeddedWorkflowSpecId
                            ? getSpecById(node.data.embeddedWorkflowSpecId)
                            : null

                        return (
                          <div key={node.id} className="flex items-center gap-1 py-0.5 text-xs text-slate-500">
                            <span className="text-slate-400 w-4 text-right">{idx + 1}.</span>
                            <span
                              className={cn(
                                'px-1 rounded text-[10px]',
                                node.type === 'start' && 'bg-green-100 text-green-700',
                                node.type === 'end' && 'bg-red-100 text-red-700',
                                node.type === 'workflowProxy' && 'bg-blue-100 text-blue-700',
                                node.type === 'actionProxyWait' && 'bg-slate-100 text-slate-700',
                                node.type === 'select1' && 'bg-amber-100 text-amber-700',
                                node.type === 'waitAny' && 'bg-amber-100 text-amber-700',
                                node.type === 'parallel' && 'bg-purple-100 text-purple-700',
                                node.type === 'waitAll' && 'bg-purple-100 text-purple-700',
                              )}
                            >
                              {getNodeTypeLabel(node.type)}
                            </span>
                            <span className="truncate">{node.data.label || '(no label)'}</span>
                            <code
                              className="text-[8px] text-slate-400 font-mono bg-slate-50 px-0.5 rounded"
                              title={node.id}
                            >
                              {node.id.slice(0, 8)}
                            </code>
                            <span className="flex-1" />
                            {isChildWorkflow && node.data.subWorkflowMode && (
                              <span
                                className={cn(
                                  'text-[10px] px-1 rounded',
                                  node.data.subWorkflowMode === 'embedded'
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'bg-green-50 text-green-600',
                                )}
                              >
                                {node.data.subWorkflowMode}
                              </span>
                            )}
                            {embeddedSpec && <span className="text-[10px] text-slate-400">→ {embeddedSpec.name}</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
            {children.map((child) => renderLibrary(child, 1))}
          </div>
        )}
      </div>
    )
  }

  const typeLabels: Record<string, string> = {
    workflow: 'Workflows',
    step: 'Steps',
    environment: 'Environments',
    action: 'Actions',
  }

  const typeColors: Record<string, string> = {
    workflow: 'bg-blue-100 text-blue-700',
    step: 'bg-green-100 text-green-700',
    environment: 'bg-purple-100 text-purple-700',
    action: 'bg-orange-100 text-orange-700',
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8 w-8 p-0 text-slate-600 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
        title="Summary Panel"
      >
        <Eye className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Summary Panel - Database Contents
              <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading} className="ml-auto h-7">
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 pr-2">
            {loading && !data ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin h-6 w-6 border-2 border-slate-300 border-t-blue-600 rounded-full" />
              </div>
            ) : data ? (
              <>
                <div className="text-xs text-slate-500 mb-2">
                  Total: {data.libraries.length} libraries, {data.specifications.length} specifications
                </div>

                {['workflow', 'step', 'environment', 'action'].map((type) => {
                  const libs = getLibrariesByType(type)
                  const isExpanded = expandedTypes.has(type)
                  const totalSpecs = libs.reduce((sum, lib) => {
                    const countSpecsRecursive = (libId: string): number => {
                      const specs = getSpecsForLibrary(libId)
                      const children = getChildLibraries(libId)
                      return specs.length + children.reduce((s, c) => s + countSpecsRecursive(c.id), 0)
                    }
                    return sum + countSpecsRecursive(lib.id)
                  }, 0)

                  return (
                    <div key={type} className="border rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleType(type)}
                        className={cn('w-full flex items-center gap-2 px-3 py-2', typeColors[type])}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <span className="font-medium">{typeLabels[type]}</span>
                        <span className="text-xs opacity-75">
                          ({libs.length} libraries, {totalSpecs} specs)
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="p-2 bg-white">
                          {libs.length === 0 ? (
                            <p className="text-sm text-slate-400 italic px-2">No libraries</p>
                          ) : (
                            libs.map((lib) => renderLibrary(lib))
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            ) : (
              <p className="text-slate-500 text-center py-8">Failed to load data</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
