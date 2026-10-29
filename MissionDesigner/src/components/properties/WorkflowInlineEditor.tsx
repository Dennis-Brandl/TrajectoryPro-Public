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

import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { Input } from '@mission/ui'
import { Textarea } from '@mission/ui'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { useShallow } from 'zustand/shallow'
import { SectionLabel } from './SectionLabel'
import { InputsEditor } from './InputsEditor'
import { OutputsEditor } from './OutputsEditor'
import { ValuesEditor } from './ValuesEditor'
import { ResourcesEditor } from './ResourcesEditor'
import { TryEditor, type TrySpec } from './TryEditor'
import { useIsChildWorkflow } from '@/hooks/useIsChildWorkflow'
import { useAvailableValueTypes } from '@/hooks/useAvailableValueTypes'
import type { ParameterSpec, ValueSpec, ResourceSpec } from '@/types/nodes'
import * as Accordion from '@radix-ui/react-accordion'
import { CollapsibleSection } from './CollapsibleSection'
import { TypeNameCombo } from './TypeNameCombo'
import { WORKFLOW_TYPE_NAMES, MAX_TYPE_NAME_LENGTH, TYPE_NAME_TOO_LONG_MESSAGE } from '@/lib/workflowTypeNames'

interface WorkflowDraft {
  name: string
  description: string
  typeName: string
  inputs: ParameterSpec[]
  outputs: ParameterSpec[]
  values: ValueSpec[]
  resources: ResourceSpec[]
  tries: TrySpec[]
}

export function WorkflowInlineEditor() {
  const isChild = useIsChildWorkflow()
  const { allValueTypes } = useAvailableValueTypes()
  const {
    workflowInputs,
    workflowOutputs,
    workflowValues,
    workflowResources,
    workflowTrySpecifications,
    setWorkflowInputs,
    setWorkflowOutputs,
    setWorkflowValues,
    setWorkflowResources,
    setWorkflowTrySpecifications,
  } = useFlowStore(
    useShallow((state) => ({
      workflowInputs: state.workflowInputs,
      workflowOutputs: state.workflowOutputs,
      workflowValues: state.workflowValues,
      workflowResources: state.workflowResources,
      workflowTrySpecifications: state.workflowTrySpecifications,
      setWorkflowInputs: state.setWorkflowInputs,
      setWorkflowOutputs: state.setWorkflowOutputs,
      setWorkflowValues: state.setWorkflowValues,
      setWorkflowResources: state.setWorkflowResources,
      setWorkflowTrySpecifications: state.setWorkflowTrySpecifications,
    })),
  )

  const selectedSpecificationId = useLibraryStore((state) => state.selectedSpecificationId)
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId)
  const specifications = useLibraryStore((state) => state.specifications)

  const allNodes = useFlowStore((s) => s.nodes)
  const availableCatches = allNodes
    .filter((n) => n.type === 'catch' && (n.data as { catchId?: string }).catchId)
    .map((n) => ({ catchId: (n.data as { catchId: string }).catchId }))

  const currentSpecification = useMemo(() => {
    if (!selectedSpecificationId || !selectedLibraryId) return null
    const libSpecs = specifications.get(selectedLibraryId)
    return libSpecs?.find((s) => s.id === selectedSpecificationId) || null
  }, [selectedSpecificationId, selectedLibraryId, specifications])

  const [draft, setDraft] = useState<WorkflowDraft>(() => ({
    name: currentSpecification?.name ?? '',
    description: currentSpecification?.description ?? '',
    typeName: currentSpecification?.typeName ?? '',
    inputs: structuredClone(workflowInputs),
    outputs: structuredClone(workflowOutputs),
    values: structuredClone(workflowValues),
    resources: structuredClone(workflowResources),
    tries: structuredClone(workflowTrySpecifications),
  }))

  const currentSpecRef = useRef(currentSpecification)
  currentSpecRef.current = currentSpecification

  // Suppress auto-save when draft is set programmatically (store sync / spec switch)
  const suppressAutoSave = useRef(true)

  // Track the array refs that the auto-save last wrote to the flow store so
  // Effect 2 can skip the no-op round-trip (auto-save writes → store fires →
  // Effect 2 clones into new draft → auto-save sees new draft → repeat).
  const lastWrittenArrays = useRef<{
    inputs: ParameterSpec[]
    outputs: ParameterSpec[]
    values: ValueSpec[]
    resources: ResourceSpec[]
    tries: TrySpec[]
  } | null>(null)

  // Full reset when the selected workflow changes.
  useEffect(() => {
    suppressAutoSave.current = true
    lastWrittenArrays.current = null
    const d: WorkflowDraft = {
      name: currentSpecification?.name ?? '',
      description: currentSpecification?.description ?? '',
      typeName: currentSpecification?.typeName ?? '',
      inputs: structuredClone(workflowInputs),
      outputs: structuredClone(workflowOutputs),
      values: structuredClone(workflowValues),
      resources: structuredClone(workflowResources),
      tries: structuredClone(workflowTrySpecifications),
    }
    setDraft(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSpecificationId])

  // Sync only the flow-store arrays when they change externally (e.g. async hydration).
  // Do NOT reset name/description here — that would overwrite the user's in-progress edits
  // because the spec update from the debounced save may not have propagated yet.
  // Skip if the change came from our own auto-save write-back (prevents render loop).
  useEffect(() => {
    const lw = lastWrittenArrays.current
    if (
      lw &&
      lw.inputs === workflowInputs &&
      lw.outputs === workflowOutputs &&
      lw.values === workflowValues &&
      lw.resources === workflowResources &&
      lw.tries === workflowTrySpecifications
    ) {
      // The store arrays are exactly the refs we wrote — skip the round-trip.
      return
    }
    suppressAutoSave.current = true
    setDraft((prev) => ({
      ...prev,
      inputs: structuredClone(workflowInputs),
      outputs: structuredClone(workflowOutputs),
      values: structuredClone(workflowValues),
      resources: structuredClone(workflowResources),
      tries: structuredClone(workflowTrySpecifications),
    }))
  }, [workflowInputs, workflowOutputs, workflowValues, workflowResources, workflowTrySpecifications])

  // Auto-save draft to store with 300ms debounce
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    // Skip auto-save when draft was set by store sync (not user input)
    if (suppressAutoSave.current) {
      suppressAutoSave.current = false
      return
    }

    const timer = setTimeout(() => {
      const d = draftRef.current

      // Save name/description to specification
      if (selectedSpecificationId) {
        const updates: Record<string, unknown> = {}
        if (d.name.trim() && d.name !== currentSpecRef.current?.name) {
          updates.name = d.name.trim()
        }
        if (d.description !== (currentSpecRef.current?.description ?? '')) {
          updates.description = d.description || null
        }
        const trimmedType = d.typeName.trim()
        if (trimmedType !== (currentSpecRef.current?.typeName ?? '') && trimmedType.length <= MAX_TYPE_NAME_LENGTH) {
          updates.typeName = trimmedType || null
        }
        if (Object.keys(updates).length > 0) {
          useSpecificationStore
            .getState()
            .updateInMemory(
              selectedSpecificationId,
              updates as { name?: string; description?: string | null; typeName?: string | null },
            )
        }
      }

      // Save inputs/outputs/values/resources/tries to flow store and track the refs
      // so Effect 2 can detect this was our own write-back.
      setWorkflowInputs(d.inputs)
      setWorkflowOutputs(d.outputs)
      setWorkflowValues(d.values)
      setWorkflowResources(d.resources)
      setWorkflowTrySpecifications(d.tries)
      lastWrittenArrays.current = {
        inputs: d.inputs,
        outputs: d.outputs,
        values: d.values,
        resources: d.resources,
        tries: d.tries,
      }
    }, 300)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  const updateDraft = useCallback((updates: Partial<WorkflowDraft>) => {
    setDraft((prev) => ({ ...prev, ...updates }))
  }, [])

  return (
    <div>
      <div className="p-3 space-y-3">
        {/* Workflow Name */}
        <div className="space-y-0.5">
          <SectionLabel label="Name" />
          <Input
            value={draft.name}
            onChange={(e) => updateDraft({ name: e.target.value })}
            placeholder="Workflow name..."
            className="h-7 text-sm font-medium"
            disabled={!selectedSpecificationId}
          />
        </div>

        {/* Description */}
        <div className="space-y-0.5">
          <SectionLabel label="Description" />
          <Textarea
            value={draft.description}
            onChange={(e) => updateDraft({ description: e.target.value })}
            placeholder="Optional description..."
            className="min-h-[40px] text-sm"
          />
        </div>

        {/* Type (ISA 88 workflow type, optional) */}
        <div className="space-y-0.5">
          <label htmlFor="workflow-type-name" className="block text-xs font-bold text-slate-500 dark:text-slate-400">
            Type
          </label>
          <TypeNameCombo
            id="workflow-type-name"
            options={WORKFLOW_TYPE_NAMES}
            value={draft.typeName}
            onChange={(e) => updateDraft({ typeName: e.target.value })}
            className="h-7 text-sm"
          />
          {draft.typeName.trim().length > MAX_TYPE_NAME_LENGTH && (
            <p className="text-xs text-red-600 dark:text-red-400">{TYPE_NAME_TOO_LONG_MESSAGE}</p>
          )}
        </div>
      </div>

      <Accordion.Root type="multiple" defaultValue={[]}>
        <CollapsibleSection value="inputs" title="Input Parameters" count={draft.inputs.length}>
          {/* Workflow Inputs — child workflows show name-only, read-only (parent defines values) */}
          <InputsEditor
            inputs={draft.inputs}
            onChange={(inputs) => updateDraft({ inputs })}
            readOnly={isChild}
            nameOnly={isChild}
            hideHeading
          />
        </CollapsibleSection>

        <CollapsibleSection value="outputs" title="Output Parameters" count={draft.outputs.length}>
          {/* Workflow Outputs — child workflows show name-only, read-only (parent defines targets) */}
          <OutputsEditor
            outputs={draft.outputs}
            onChange={(outputs) => updateDraft({ outputs })}
            readOnly={isChild}
            nameOnly={isChild}
            hideHeading
          />
        </CollapsibleSection>

        <CollapsibleSection value="values" title="Value Properties" count={draft.values.length}>
          <ValuesEditor
            values={draft.values}
            onChange={(values) => updateDraft({ values })}
            hideHeading
            availableValueTypes={allValueTypes}
          />
        </CollapsibleSection>

        <CollapsibleSection value="resources" title="Resource Definitions" count={draft.resources.length}>
          <ResourcesEditor
            resources={draft.resources}
            onChange={(resources) => updateDraft({ resources })}
            hideHeading
          />
        </CollapsibleSection>

        <CollapsibleSection value="try" title="TRY / Error Handling" count={draft.tries.length}>
          {/* Workflow-level fallback: fires when a failing step has no matching TRY of its own */}
          <TryEditor
            value={draft.tries}
            onChange={(tries) => updateDraft({ tries })}
            availableCatches={availableCatches}
            hideHeading
          />
        </CollapsibleSection>
      </Accordion.Root>
    </div>
  )
}
