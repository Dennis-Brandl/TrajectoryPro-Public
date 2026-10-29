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

import { pickLibraryByName } from '@/lib/global-team'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import type { Library, Specification } from '@/types/library'
import type { ImportResult } from '@/components/export'
import type { ImportedSpecification } from '@/lib/import/import-types'
import { createLibrary as createLibraryFlow } from '@/stores/specificationStore/libraryCrud'
import { mergeActionSignature, type ParameterSignature } from '@/lib/action-proxy/signature-sync'

export function useSpecCreation() {
  const fetchSpecifications = useLibraryStore((s) => s.fetchSpecifications)

  /**
   * Ensures all action library specs are loaded into the store for weak matching.
   */
  const ensureActionSpecsLoaded = async () => {
    const allLibs = useLibraryStore.getState().libraries
    const actionLibs = allLibs.filter((l) => l.entityType === 'action')
    for (const actionLib of actionLibs) {
      if (!useLibraryStore.getState().specifications.has(actionLib.id)) {
        await fetchSpecifications(actionLib.id)
      }
    }
  }

  /**
   * Resolves included action references for environment specs.
   * Accepts both UI format (included_actions with action_name/action_library)
   * and legacy camelCase format (includedActions with actionName/actionLibrary).
   * Always outputs UI format (included_actions with action_name/action_library).
   * Weak match: UUID first (from _importedActionMeta), then library name + action name.
   */
  const resolveIncludedActions = (data: Record<string, unknown>): Record<string, unknown> => {
    // Accept both formats
    const rawActions = (data.included_actions || data.includedActions) as Array<Record<string, string>> | undefined
    if (!rawActions || rawActions.length === 0) return data

    // Get UUID metadata if available (stored separately during import)
    const actionMeta = data._importedActionMeta as
      | Array<{
          action_name: string
          action_library: string
          action_uuid?: string
          action_version?: string
        }>
      | undefined

    const allLibs = useLibraryStore.getState().libraries
    const allSpecs = useLibraryStore.getState().specifications

    const resolved = rawActions.map((action) => {
      // Normalize field names (support both formats)
      const actionName = (action.action_name || action.actionName) as string
      const actionLibrary = (action.action_library || action.actionLibrary) as string

      // Try UUID match first (from import metadata)
      const meta = actionMeta?.find((m) => m.action_name === actionName && m.action_library === actionLibrary)
      if (meta?.action_uuid) {
        for (const [, specs] of allSpecs) {
          const match = specs.find((s) => s.id === meta.action_uuid)
          if (match) {
            const lib = allLibs.find((l) => l.id === match.libraryId)
            return { action_name: match.name, action_library: lib?.name ?? actionLibrary }
          }
        }
      }

      // Weak match: library name + action name
      const actionLib = pickLibraryByName(allLibs, actionLibrary, 'action', useLibraryStore.getState().selectedTeamId)
      if (actionLib) {
        const libSpecs = allSpecs.get(actionLib.id) || []
        const match = libSpecs.find((s) => s.name === actionName)
        if (match) {
          return { action_name: match.name, action_library: actionLib.name }
        }
      }

      // No match found - keep original reference in UI format
      return { action_name: actionName, action_library: actionLibrary }
    })

    // Output in UI format, remove legacy keys and metadata
    const result: Record<string, unknown> = { ...data, included_actions: resolved }
    delete result.includedActions
    delete result._importedActionMeta
    return result
  }

  /**
   * Recursively creates pending child workflow specifications via specificationStore
   * and links workflowProxy nodes in the parent.
   *
   * @param rootSpecId - The root specification ID (for createSpecInMemory rootId resolution)
   * @param parentSpecId - The parent spec ID (undefined for direct children of root)
   * @param pendingSpecs - Child specs to create
   * @param parentCleanData - The parent's data (for updating its workflowProxy nodes)
   * @param parentId - The parent's ID for saving updated nodes
   * @param parentIsRoot - True if parent is a root spec (use updateInMemory), false for child specs (same)
   */
  const createPendingChildWorkflows = async (
    rootSpecId: string,
    parentSpecId: string | undefined,
    pendingSpecs: Omit<Specification, 'id' | 'libraryId'>[],
    parentCleanData?: Record<string, unknown>,
    parentId?: string,
    parentIsRoot = true,
  ) => {
    const specStore = useSpecificationStore.getState()
    const parentNodes = parentCleanData?.nodes as Array<{ data: Record<string, unknown> }> | undefined
    let parentNodesUpdated = false

    // Determine the libraryId from the root spec
    const rootSpec = specStore.specs.get(rootSpecId)
    const libraryId = rootSpec?.libraryId ?? ''

    for (const spec of pendingSpecs) {
      const childPending = spec.data?._pendingChildWorkflows as Omit<Specification, 'id' | 'libraryId'>[] | undefined

      const cleanData: Record<string, unknown> = { ...spec.data }
      delete cleanData._pendingChildWorkflows
      delete cleanData._pendingEnvironmentSpecs

      const createdChildId = specStore.createSpecInMemory({
        parentId: parentSpecId ?? rootSpecId,
        libraryId,
        init: {
          name: spec.name,
          description: spec.description ?? undefined,
          typeName: spec.typeName ?? null,
          data: cleanData,
          dataSchemaVersion: spec.dataSchemaVersion,
        },
      })

      const createdChild = useSpecificationStore.getState().specs.get(createdChildId)

      if (!createdChild) {
        console.error(`[import] Failed to create child workflow spec "${spec.name}" for root ${rootSpecId}`)
        continue
      }

      // Link matching workflowProxy node in parent to this child spec and sync parameters
      if (parentNodes) {
        const proxyNode = parentNodes.find(
          (n) => n.data?.stepType === 'workflowProxy' && n.data?.label === spec.name && !n.data?.embeddedWorkflowSpecId,
        )
        if (proxyNode) {
          proxyNode.data.subWorkflowMode = 'embedded'
          proxyNode.data.embeddedWorkflowSpecId = createdChild.id
          // Sync child's workflow-level parameters to the proxy node
          const childInputs = cleanData.workflowInputs as unknown[] | undefined
          const childOutputs = cleanData.workflowOutputs as unknown[] | undefined
          if (childInputs && childInputs.length > 0) {
            proxyNode.data.inputs = childInputs
          }
          if (childOutputs && childOutputs.length > 0) {
            proxyNode.data.outputs = childOutputs
          }
          parentNodesUpdated = true
        }
      }

      // Recurse for deeply nested children
      if (childPending && childPending.length > 0) {
        await createPendingChildWorkflows(rootSpecId, createdChild.id, childPending, cleanData, createdChild.id, false)
      }
    }

    // Save updated parent nodes if any were linked
    if (parentNodesUpdated && parentCleanData && parentId) {
      useSpecificationStore.getState().updateInMemory(parentId, { data: parentCleanData })
    }
    void parentIsRoot // suppress unused warning — kept for API parity
  }

  /**
   * Creates a specification in-memory via specificationStore and returns a library-typed Specification.
   */
  const createSpecification = async (
    libraryId: string,
    init: {
      name: string
      description?: string
      typeName?: string | null
      data: Record<string, unknown>
      id?: string
      dataSchemaVersion?: number
    },
  ): Promise<Specification | null> => {
    const newId = useSpecificationStore.getState().createSpecInMemory({ parentId: null, libraryId, init })
    const spec = useSpecificationStore.getState().specs.get(newId)
    if (!spec) return null
    return {
      id: spec.id,
      libraryId: spec.libraryId,
      name: spec.name,
      description: spec.description,
      typeName: spec.typeName,
      version: spec.version,
      state: spec.state as Specification['state'],
      data: spec.data,
      history: spec.history,
      createdAt: spec.createdAt,
      updatedAt: spec.updatedAt,
    }
  }

  /**
   * Updates a specification in-memory via specificationStore.
   */
  const updateSpecification = async (
    id: string,
    patch: { data?: Record<string, unknown>; name?: string; description?: string },
  ): Promise<void> => {
    useSpecificationStore.getState().updateInMemory(id, patch)
  }

  /**
   * Creates a library via the v2 API.
   */
  const createLibrary = async (name: string, entityType: string, parentId?: string): Promise<Library | null> => {
    const result = await createLibraryFlow({
      name,
      entityType: entityType as 'workflow' | 'action' | 'environment' | 'step',
      parentLibraryId: parentId,
      teamId: useLibraryStore.getState().selectedTeamId ?? '',
    })
    if (!result) return null
    // Map to the Library type expected by callers
    return {
      id: result.id,
      name: result.name,
      entityType: result.entityType as Library['entityType'],
      description: result.description ?? '',
      version: result.version,
      parentLibraryId: result.parentLibraryId,
      environmentLibraryIds: result.environmentLibraryIds ?? [],
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    } as Library
  }

  /**
   * Creates specifications for a library, handling _pendingChildWorkflows and
   * _pendingEnvironmentSpecs for workflow specs.
   */
  const createSpecsForLibrary = async (libraryId: string, specs: ImportedSpecification[]) => {
    // Pre-load action library specs for weak matching of included actions
    const hasEnvSpecs = specs.some((s) => s.data?.includedActions)
    if (hasEnvSpecs) {
      await ensureActionSpecsLoaded()
    }

    for (const spec of specs) {
      // Extract pending items before saving
      const pendingChildren = spec.data?._pendingChildWorkflows as Omit<Specification, 'id' | 'libraryId'>[] | undefined
      const pendingEnvSpecs = spec.data?._pendingEnvironmentSpecs as
        | Omit<Specification, 'id' | 'libraryId'>[]
        | undefined

      // Strip pending items from data before saving to DB
      let cleanData: Record<string, unknown> = { ...spec.data }
      delete cleanData._pendingChildWorkflows
      delete cleanData._pendingEnvironmentSpecs

      // Resolve included action references for environment specs
      if (cleanData.includedActions || cleanData.included_actions || cleanData._importedActionMeta) {
        cleanData = resolveIncludedActions(cleanData)
      }

      const newSpec = await createSpecification(libraryId, {
        name: spec.name,
        description: spec.description || undefined,
        typeName: spec.typeName ?? null,
        data: cleanData,
        id: spec.id, // preserve source OID for Actions/Environments (undefined → fresh id)
        dataSchemaVersion: spec.dataSchemaVersion,
      })

      if (!newSpec) {
        console.error(`[import] Failed to create specification "${spec.name}" in library ${libraryId}`)
      }

      // If there are pending environment specs, try weak match before creating new
      if (newSpec && pendingEnvSpecs && pendingEnvSpecs.length > 0) {
        const allLibs = useLibraryStore.getState().libraries
        const allStoreSpecs = useLibraryStore.getState().specifications
        const envLibraries = allLibs.filter((l) => l.entityType === 'environment')

        // Ensure all environment library specs are loaded for weak matching
        for (const envLib of envLibraries) {
          if (!allStoreSpecs.has(envLib.id)) {
            await fetchSpecifications(envLib.id)
          }
        }
        // Re-read after potential fetches
        const freshStoreSpecs = useLibraryStore.getState().specifications

        const envSpecIds: string[] = []
        let newEnvLibrary: Library | null = null

        for (const envSpec of pendingEnvSpecs) {
          const envLibName = envSpec.data?._libraryName as string | undefined
          const envVersion = envSpec.data?._version as string | undefined

          // Weak match: same library name + same spec name + same version
          let matchedSpecId: string | null = null
          if (envLibName) {
            const existingLib = pickLibraryByName(
              envLibraries,
              envLibName,
              'environment',
              useLibraryStore.getState().selectedTeamId,
            )
            if (existingLib) {
              const existingSpecs = freshStoreSpecs.get(existingLib.id) || []
              const match = existingSpecs.find(
                (s) => s.name === envSpec.name && (!envVersion || envVersion === '1.0.0'), // version match (all local specs are 1.0.0)
              )
              if (match) {
                matchedSpecId = match.id
              }
            }
          }

          if (matchedSpecId) {
            // Weak match found — use existing environment spec
            envSpecIds.push(matchedSpecId)

            // Weak match actions: for each included action in the imported env spec,
            // verify the action exists in the system and resolve references
            const importedActions = envSpec.data?.includedActions as
              | Array<{
                  actionName: string
                  actionLibrary: string
                }>
              | undefined
            if (importedActions) {
              const actionLibs = allLibs.filter((l) => l.entityType === 'action')
              for (const action of importedActions) {
                const actionLib = pickLibraryByName(
                  actionLibs,
                  action.actionLibrary,
                  'action',
                  useLibraryStore.getState().selectedTeamId,
                )
                if (actionLib) {
                  const actionSpecs = freshStoreSpecs.get(actionLib.id) || []
                  const existingAction = actionSpecs.find((s) => s.name === action.actionName)
                  if (existingAction) {
                    // Action exists — workflow step references will match by name
                    // Update any action proxy steps in the workflow that reference this action
                    const nodes = cleanData.nodes as Array<{ data: Record<string, unknown> }> | undefined
                    if (nodes) {
                      for (const node of nodes) {
                        if (node.data?.label === action.actionName && node.data?.stepType === 'actionProxyWait') {
                          // Sync step inputs/outputs from the existing action spec, preserving
                          // workflow-specific assignments (input values, output targets) — the
                          // same rule the editor's "Update from action" applies (spec 2026-09-04 D8).
                          const actionData = existingAction.data as ParameterSignature & { values?: unknown }
                          const merged = mergeActionSignature(node.data as ParameterSignature, actionData)
                          if (actionData.inputs) node.data.inputs = merged.inputs
                          if (actionData.outputs) node.data.outputs = merged.outputs
                          if (actionData.values) node.data.values = actionData.values
                        }
                      }
                    }
                  }
                }
              }
            }
          } else {
            // No weak match — create new environment spec
            if (!newEnvLibrary) {
              newEnvLibrary = await createLibrary(`${spec.name} Environments`, 'environment')
            }
            if (newEnvLibrary) {
              // Strip weak-match metadata before saving
              const envCleanData: Record<string, unknown> = { ...envSpec.data }
              delete envCleanData._libraryName
              delete envCleanData._version
              const newEnvSpec = await createSpecification(newEnvLibrary.id, {
                name: envSpec.name,
                description: envSpec.description || undefined,
                data: envCleanData,
                dataSchemaVersion: envSpec.dataSchemaVersion,
              })
              if (newEnvSpec) {
                envSpecIds.push(newEnvSpec.id)
              }
            }
          }
        }

        // Link environment specs to the workflow (mutate cleanData so child workflow
        // processing below also includes these IDs when it saves)
        if (envSpecIds.length > 0) {
          cleanData.environmentSpecIds = envSpecIds
          await updateSpecification(newSpec.id, {
            data: cleanData,
          })
        }
      }

      // If there are pending child workflows, create them via specificationStore
      // and link workflowProxy nodes in the parent to the new child specs
      if (newSpec && pendingChildren && pendingChildren.length > 0) {
        await createPendingChildWorkflows(newSpec.id, undefined, pendingChildren, cleanData, newSpec.id)
      }
    }

    // Sync libraryStore view layer so sidebar shows imported specs
    fetchSpecifications(libraryId)
  }

  /**
   * Recursively creates child libraries under a parent.
   */
  const createChildLibraries = async (
    parentId: string,
    children: ImportResult[],
    entityType: import('@/types/library').EntityType,
  ) => {
    for (const child of children) {
      if (!child.library) continue

      const newChild = await createLibrary(child.library.name, entityType, parentId)
      if (!newChild) {
        console.error(`[import] Failed to create child library "${child.library.name}" under parent ${parentId}`)
        continue
      }

      // Create specs for this child library
      await createSpecsForLibrary(newChild.id, child.specifications || [])

      // Recurse into grandchildren
      if (child.childLibraries && child.childLibraries.length > 0) {
        await createChildLibraries(newChild.id, child.childLibraries, entityType)
      }
    }
  }

  return { createSpecsForLibrary, createChildLibraries, ensureActionSpecsLoaded }
}
