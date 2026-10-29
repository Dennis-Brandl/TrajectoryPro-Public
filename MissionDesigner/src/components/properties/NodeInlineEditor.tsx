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

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@mission/ui'
import { Input } from '@mission/ui'
import { Label } from '@mission/ui'
import { Textarea } from '@mission/ui'
import { useFlowStore } from '@/stores/flowStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSpecificationStore } from '@/stores/specificationStore'
import { InputsEditor } from './InputsEditor'
import { OutputsEditor } from './OutputsEditor'
import { ValuesEditor } from './ValuesEditor'
import { ResourcesEditor } from './ResourcesEditor'
import { ResourceCommandEditor } from './ResourceCommandEditor'
import { TryEditor, type TrySpec } from './TryEditor'
import { ReturnConfigEditor, type ReturnConfig } from './ReturnConfigEditor'
import { CatchIdEditor } from './CatchIdEditor'
import { CatchTriggeredBy } from './CatchTriggeredBy'
import { findCatchTriggers } from '@/lib/canvas/findCatchTriggers'
import { ActionSelector } from './ActionSelector'
import { DurationInput } from './DurationInput'
import { joinDuration } from '@/lib/duration'
import { ActionSyncBanner } from './ActionSyncBanner'
import { ActionTimeLimitField } from './ActionTimeLimitField'
import { setProxyTimeout } from '@/lib/action-proxy/default-timeout'
import { actionSelectionToDraft, type SelectedAction } from './action-selection'
import { SubWorkflowSelector } from './SubWorkflowSelector'
import { YesNoStepConfig } from './YesNoStepConfig'
import { Select1StepConfig } from './Select1StepConfig'
import { partitionCatchNetworks } from '@/lib/canvas/catch-network-partition'
import { CatchOutputsList } from './CatchOutputsList'
import { withCanonicalCatchOutputs } from '@/lib/catch-outputs'
import { NODE_TYPE_TO_STEP_TYPE, TRY_CAPABLE_NODE_TYPES } from '@/lib/packageFormat/export-types'
import { useAvailableValueTypes } from '@/hooks/useAvailableValueTypes'
import { useActionProxySyncState } from '@/hooks/useActionProxySyncState'
import * as Accordion from '@radix-ui/react-accordion'
import { CollapsibleSection } from './CollapsibleSection'
import type { StepNodeData, NodeType, ParameterSpec, ResourceSpec, ValueSpec } from '@/types/nodes'

const ScriptEditorModal = lazy(() => import('./ScriptEditorModal').then((m) => ({ default: m.ScriptEditorModal })))

// Node types that show standard input/output editors
export const PARAMETERIZED_TYPES: NodeType[] = [
  'actionProxyWait',
  'workflowProxy',
  'scriptStep',
  'gateStep',
  'userInteractionStep',
  'yesNoStep',
  'catch',
  // SELECT 1 (spec 2026-09-04 §5.2.4): inputs only — a routed Action Property can drive the
  // branch; no outputs.
  'select1',
]

// Node types that use UI parameters instead of standard inputs/outputs
const UI_STEP_TYPES: NodeType[] = ['yesNoStep', 'userInteractionStep']

// Node types that are pure control flow (no values or resource commands)
const CONTROL_FLOW_TYPES: NodeType[] = ['start', 'end', 'waitAny', 'waitAll', 'parallel', 'return', 'catch']

interface NodeInlineEditorProps {
  nodeId: string
  nodeType: NodeType
  initialData: StepNodeData
  initialChildData: {
    inputs: ParameterSpec[]
    outputs: ParameterSpec[]
    values: ValueSpec[]
    resources: ResourceSpec[]
  } | null
  isEmbeddedSubWorkflow: boolean
  isReferencedSubWorkflow: boolean
}

export function NodeInlineEditor({
  nodeId,
  nodeType,
  initialData,
  initialChildData,
  isEmbeddedSubWorkflow,
  isReferencedSubWorkflow,
}: NodeInlineEditorProps) {
  const updateNodeData = useFlowStore((state) => state.updateNodeData)
  const allNodes = useFlowStore((s) => s.nodes)
  const workflowTries = useFlowStore((s) => s.workflowTrySpecifications)
  const specifications = useLibraryStore((state) => state.specifications)
  const { allValueTypes } = useAvailableValueTypes()

  const allEdges = useFlowStore((s) => s.edges)

  const availableCatches = allNodes
    .filter((n) => n.type === 'catch' && (n.data as { catchId?: string }).catchId)
    .map((n) => ({ catchId: (n.data as { catchId: string }).catchId }))

  const takenCatchIds = allNodes
    .filter((n) => n.type === 'catch' && n.id !== nodeId)
    .map((n) => (n.data as { catchId?: string }).catchId)
    .filter((x): x is string => !!x)

  const gotoTargets = (() => {
    const steps = allNodes.map((n) => ({
      oid: n.id,
      step_type: NODE_TYPE_TO_STEP_TYPE[(n.type ?? 'start') as keyof typeof NODE_TYPE_TO_STEP_TYPE] ?? 'UNKNOWN',
      catch_id: (n.data as { catchId?: string }).catchId,
    }))
    const part = partitionCatchNetworks(
      steps,
      allEdges.map((e) => ({ from_step_id: e.source, to_step_id: e.target })),
    )
    return allNodes
      .filter((n) => part.mainFlowStepOids.has(n.id) && n.type !== 'start' && n.type !== 'catch' && n.type !== 'return')
      .map((n) => ({ id: n.id, label: (n.data as { label?: string }).label || n.id }))
  })()

  const [draft, setDraft] = useState<StepNodeData>(() => structuredClone(initialData))

  // Spec 2026-09-04 §6.3: evaluated against the DRAFT so "Update from action" flips the
  // banner off as soon as the merged signature lands, before autosave writes it. Gated on
  // node type (`enabled`) — this editor runs for every node type and StepNodeData has no
  // node-type field to check inside the hook itself, so an ungated call would run the
  // resolver for SCRIPT/CATCH/GATE/etc. nodes for nothing (final review #1 ride-along A).
  const actionSync = useActionProxySyncState(draft, nodeType === 'actionProxyWait')

  const [childDraft, setChildDraft] = useState<{
    inputs: ParameterSpec[]
    outputs: ParameterSpec[]
    values: ValueSpec[]
    resources: ResourceSpec[]
  } | null>(() => (initialChildData ? structuredClone(initialChildData) : null))
  const [scriptEditorOpen, setScriptEditorOpen] = useState(false)

  // Open script editor when triggered by canvas double-click
  const editDialogRequest = useFlowStore((s) => s.editDialogRequest)
  useEffect(() => {
    if (editDialogRequest === 'scriptEditor' && (nodeType === 'scriptStep' || nodeType === 'gateStep')) {
      setScriptEditorOpen(true)
      useFlowStore.getState().requestEditDialog(null)
    }
  }, [editDialogRequest, nodeType])

  // Refs to access current values in effects without stale closures
  const initialDataRef = useRef(initialData)
  const initialChildDataRef = useRef(initialChildData)
  initialDataRef.current = initialData
  initialChildDataRef.current = initialChildData

  // Reset draft when nodeId changes
  useEffect(() => {
    setDraft(structuredClone(initialDataRef.current))
    if (initialChildDataRef.current) {
      setChildDraft(structuredClone(initialChildDataRef.current))
    } else {
      setChildDraft(null)
    }
    setScriptEditorOpen(false)
  }, [nodeId]) // Key on nodeId only

  const updateDraft = useCallback((updates: Partial<StepNodeData>) => {
    setDraft((prev) => ({ ...prev, ...updates }))
  }, [])

  // Derived from draft — must come after draft is declared
  const currentCatchId = (draft.catchId as string | undefined) ?? ''

  // Write to child embedded spec (optimistic update + persist)
  // Checks libraryStore first (legacy path), then specificationStore (v7.0 path)
  const commitChildSpecData = useCallback(
    (updates: Record<string, unknown>) => {
      const embeddedSpecId = draft.embeddedWorkflowSpecId
      if (!embeddedSpecId) return

      // Try libraryStore first (legacy embedded specs stored as sibling Specification rows)
      for (const [libId, specs] of specifications.entries()) {
        const idx = specs.findIndex((s) => s.id === embeddedSpecId)
        if (idx !== -1) {
          const childSpec = specs[idx]
          const existingData = (childSpec.data || {}) as Record<string, unknown>
          const mergedData = { ...existingData, ...updates }

          const newSpecs = new Map(specifications)
          const newLibSpecs = [...specs]
          newLibSpecs[idx] = { ...childSpec, data: mergedData }
          newSpecs.set(libId, newLibSpecs)
          useLibraryStore.setState({ specifications: newSpecs })

          useSpecificationStore.getState().updateInMemory(embeddedSpecId, { data: mergedData })
          return
        }
      }

      // Try specificationStore (v7.0 child_specification table)
      const specState = useSpecificationStore.getState()
      const childSpec = specState.specs.get(embeddedSpecId)
      if (childSpec) {
        const existingData = (childSpec.data || {}) as Record<string, unknown>
        const mergedData = { ...existingData, ...updates }
        specState.updateInMemory(embeddedSpecId, { data: mergedData })
        return
      }
    },
    [draft.embeddedWorkflowSpecId, specifications],
  )

  // Auto-save draft to store with 300ms debounce
  const draftRef = useRef(draft)
  const childDraftRef = useRef(childDraft)
  draftRef.current = draft
  childDraftRef.current = childDraft
  const isFirstRender = useRef(true)

  useEffect(() => {
    // Skip auto-save on first render (initial load)
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    const timer = setTimeout(() => {
      const d = draftRef.current
      const cd = childDraftRef.current

      // For embedded sub-workflows, sync child params to the proxy node so they're
      // visible in the canvas and survive export/import round-trips
      if (isEmbeddedSubWorkflow && cd) {
        updateNodeData(nodeId, { ...d, inputs: cd.inputs, outputs: cd.outputs })
        commitChildSpecData({
          workflowInputs: cd.inputs,
          workflowOutputs: cd.outputs,
          workflowValues: cd.values,
          workflowResources: cd.resources,
        })
      } else {
        updateNodeData(nodeId, d)
      }
    }, 300)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, childDraft])

  // Reset isFirstRender when nodeId changes (so next draft change from user triggers save)
  useEffect(() => {
    isFirstRender.current = true
  }, [nodeId])

  // Spec 2026-09-04 §6.4.4: a bulk update ("Update all" in the header) rewrote node data
  // underneath an open panel — re-seed the draft from the live node data. The bulk update
  // ships `nodes` and `nodeDataRevision` in ONE store set, so by the time this effect runs the
  // parent has already passed the fresh initialData (parent renders before child in one
  // commit). Marking isFirstRender first means the autosave effect swallows this draft change
  // instead of writing the same data straight back (the nodeId reset relies on the same flag).
  // Keystrokes typed inside the 300ms autosave window right before a bulk update or an undo
  // are discarded by the re-seed — a deliberate trade-off, because guarding on the
  // `initialData` reference left bumps unconsumed and let the panel's own autosave re-seed
  // (spec §11).
  const nodeDataRevision = useFlowStore((s) => s.nodeDataRevision)
  const seenRevision = useRef(nodeDataRevision)
  useEffect(() => {
    if (seenRevision.current === nodeDataRevision) return
    seenRevision.current = nodeDataRevision
    isFirstRender.current = true
    setDraft(structuredClone(initialDataRef.current))
  }, [nodeDataRevision])

  // Action selection handler — copies inputs/outputs, sets the label, and WRITES
  // the runtime oid binding so the stored contract follows the selection.
  const handleActionSelect = useCallback(
    (action: SelectedAction) => {
      updateDraft(actionSelectionToDraft(action, draftRef.current))
    },
    [updateDraft],
  )

  const showParams = PARAMETERIZED_TYPES.includes(nodeType)
  const showActionSelector = nodeType === 'actionProxyWait'
  const showSubWorkflowSelector = nodeType === 'workflowProxy'
  const showUIParameters = UI_STEP_TYPES.includes(nodeType)

  // The lists behind the parameter sections — an embedded sub-workflow edits the child's
  // own lists, everything else edits the step's. Their lengths are shown in the section
  // headers (e.g. "INPUT PARAMETERS (3)"), so they are computed once here.
  const inputList = isEmbeddedSubWorkflow ? (childDraft?.inputs ?? []) : draft.inputs || []
  const outputList = isEmbeddedSubWorkflow ? (childDraft?.outputs ?? []) : draft.outputs || []
  const valueList = isEmbeddedSubWorkflow ? (childDraft?.values ?? []) : draft.values || []
  // CATCH shows the four canonical trigger-info outputs even when none are stored yet.
  const outputCount = nodeType === 'catch' ? withCanonicalCatchOutputs(draft.outputs || []).length : outputList.length

  return (
    <>
      <div className="p-3 space-y-3">
        {/* Step Label */}
        <div className="space-y-0.5">
          <Label className="text-xs">Step Label</Label>
          <Input value={draft.label} onChange={(e) => updateDraft({ label: e.target.value })} className="h-7 text-sm" />
        </div>

        {/* Description */}
        <div className="space-y-0.5">
          <Textarea
            value={draft.description || ''}
            onChange={(e) => updateDraft({ description: e.target.value })}
            placeholder="Optional description..."
            className="min-h-[40px] text-sm"
          />
        </div>

        {/* Action Selector (actionProxyWait) */}
        {showActionSelector && (
          <>
            <ActionSelector
              selectedActionName={draft.actionName}
              environmentSpecId={draft.environmentSpecId}
              onActionSelect={handleActionSelect}
            />
            <ActionSyncBanner
              state={actionSync}
              onApply={(merged) => updateDraft({ inputs: merged.inputs, outputs: merged.outputs })}
            />
            <ActionTimeLimitField
              timeoutMs={draft.actionProxyConfig?.timeout_ms}
              disabled={!draft.actionProxyConfig}
              onChange={(ms) => {
                const cfg = draftRef.current.actionProxyConfig
                if (cfg) updateDraft({ actionProxyConfig: setProxyTimeout(cfg, ms) })
              }}
            />
          </>
        )}

        {/* Sub-Workflow Selector (workflowProxy) */}
        {showSubWorkflowSelector && (
          <SubWorkflowSelector
            mode={draft.subWorkflowMode}
            referencedStepSpecId={draft.referencedStepSpecId}
            referencedStepLibraryId={draft.referencedStepLibraryId}
            referencedStepName={draft.referencedStepName}
          />
        )}
      </div>

      <Accordion.Root type="multiple" defaultValue={[]}>
        {/* Inputs — calling step gets full editing, referenced sub-workflows are read-only; CATCH has no inputs */}
        {showParams && nodeType !== 'catch' && (
          <CollapsibleSection value="inputs" title="Input Parameters" count={inputList.length}>
            <InputsEditor
              inputs={inputList}
              onChange={(inputs) => {
                if (isEmbeddedSubWorkflow && childDraft) {
                  setChildDraft({ ...childDraft, inputs })
                } else {
                  updateDraft({ inputs })
                }
              }}
              readOnly={showActionSelector || isReferencedSubWorkflow}
              nodeId={nodeId}
              hideHeading
              includeActionProperties
            />
          </CollapsibleSection>
        )}

        {/* Outputs — calling step gets full editing, referenced sub-workflows are read-only.
            CATCH outputs are the fixed runtime-supplied trigger info: read-only list, no editing.
            GATE has no output parameters (spec §4). SELECT 1 has no output parameters either
            (spec 2026-09-04 §5.2.4). */}
        {showParams && nodeType !== 'gateStep' && nodeType !== 'select1' && (
          <CollapsibleSection value="outputs" title="Output Parameters" count={outputCount}>
            {nodeType === 'catch' ? (
              <CatchOutputsList outputs={draft.outputs || []} />
            ) : (
              <OutputsEditor
                outputs={outputList}
                onChange={(outputs) => {
                  if (isEmbeddedSubWorkflow && childDraft) {
                    setChildDraft({ ...childDraft, outputs })
                  } else {
                    updateDraft({ outputs })
                  }
                }}
                readOnly={showActionSelector || isReferencedSubWorkflow}
                hideHeading
              />
            )}
          </CollapsibleSection>
        )}

        {/* Values — hidden on scriptStep, gateStep, Select 1, and Action Proxy steps. */}
        {!showUIParameters &&
          !CONTROL_FLOW_TYPES.includes(nodeType) &&
          nodeType !== 'scriptStep' &&
          nodeType !== 'gateStep' &&
          nodeType !== 'select1' &&
          nodeType !== 'actionProxyWait' && (
            <CollapsibleSection value="values" title="Value Properties" count={valueList.length}>
              <ValuesEditor
                values={valueList}
                onChange={(values) => {
                  if (isEmbeddedSubWorkflow && childDraft) {
                    setChildDraft({ ...childDraft, values })
                  } else {
                    updateDraft({ values })
                  }
                }}
                readOnly={isReferencedSubWorkflow}
                hideHeading
                availableValueTypes={allValueTypes}
              />
            </CollapsibleSection>
          )}

        {/* User Interaction Step: Form Designer placeholder */}
        {nodeType === 'userInteractionStep' && (
          <CollapsibleSection value="form" title="Form">
            <div className="rounded border border-dashed border-slate-300 dark:border-slate-600 p-4 text-center text-sm text-slate-500 dark:text-slate-400">
              Form designer available via double-click on canvas node
            </div>
          </CollapsibleSection>
        )}

        {/* Yes/No Step Configuration */}
        {nodeType === 'yesNoStep' && (
          <CollapsibleSection value="yesno" title="Yes/No Configuration">
            <YesNoStepConfig
              data={draft}
              onChange={(updates) => updateDraft(updates)}
              readOnly={isReferencedSubWorkflow}
            />
          </CollapsibleSection>
        )}

        {/* Script Step: Repeat until done (spec 2026-10-13 §6.6) + the full-screen editor */}
        {nodeType === 'scriptStep' && (
          <CollapsibleSection value="script" title="Script">
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    id="script-repeat"
                    checked={draft.scriptRepeat === true}
                    onChange={(e) => updateDraft({ scriptRepeat: e.target.checked })}
                  />
                  Repeat until done
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  When on, the script runs again every cycle until it returns true. Its state object keeps values
                  between runs.
                </p>
              </div>
              {draft.scriptRepeat === true && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="script-cycle-seconds">Check every (seconds)</Label>
                    <Input
                      id="script-cycle-seconds"
                      type="number"
                      min={1}
                      step={1}
                      value={draft.scriptCycleSeconds ?? 5}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        updateDraft({ scriptCycleSeconds: Number.isFinite(v) && v >= 1 ? v : 5 })
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="script-limit-weeks">Time limit</Label>
                    <DurationInput
                      idPrefix="script-limit"
                      value={draft.scriptTimeLimit}
                      onChange={(scriptTimeLimit) => updateDraft({ scriptTimeLimit })}
                      emptyText="No time limit"
                    />
                  </div>
                  {joinDuration(draft.scriptTimeLimit) > 0 && (
                    <div className="space-y-1">
                      <Label htmlFor="script-on-time-limit">When the time limit is reached</Label>
                      <select
                        id="script-on-time-limit"
                        className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                        value={draft.scriptOnTimeLimit ?? 'error'}
                        onChange={(e) =>
                          updateDraft({ scriptOnTimeLimit: e.target.value === 'complete' ? 'complete' : undefined })
                        }
                      >
                        <option value="error">Fail the step</option>
                        <option value="complete">Complete with current outputs</option>
                      </select>
                    </div>
                  )}
                </>
              )}
              <Button variant="outline" size="sm" onClick={() => setScriptEditorOpen(true)}>
                Edit Script
              </Button>
            </div>
          </CollapsibleSection>
        )}

        {/* Gate Step: cycle time + Control Previous Action + the shared script editor
            (spec 2026-08-29 §8.2, amended 2026-08-30 for opt-in armed behavior) */}
        {nodeType === 'gateStep' && (
          <CollapsibleSection value="gate" title="Gate">
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="gate-mode">Mode</Label>
                <select
                  id="gate-mode"
                  className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                  value={draft.gateMode ?? 'condition'}
                  onChange={(e) => {
                    const v = e.target.value as 'condition' | 'timer' | 'condition_or_timer'
                    updateDraft({ gateMode: v === 'condition' ? undefined : v })
                  }}
                >
                  <option value="condition">Condition</option>
                  <option value="timer">Timer</option>
                  <option value="condition_or_timer">Condition with timeout</option>
                </select>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {(draft.gateMode ?? 'condition') === 'condition'
                    ? 'Opens when the gate script returns TRUE.'
                    : draft.gateMode === 'timer'
                      ? 'Opens when the delay has passed since the gate started. No script runs.'
                      : 'Opens when the script returns TRUE or the delay has passed, whichever comes first.'}
                </p>
              </div>
              {(draft.gateMode === 'timer' || draft.gateMode === 'condition_or_timer') && (
                <div className="space-y-1">
                  <Label htmlFor="gate-delay-weeks">Delay</Label>
                  <DurationInput
                    idPrefix="gate-delay"
                    value={draft.gateDelay}
                    onChange={(gateDelay) => updateDraft({ gateDelay })}
                  />
                </div>
              )}
              {draft.gateMode !== 'timer' && (
                <div className="space-y-1">
                  <Label htmlFor="gate-cycle-seconds">Cycle time (seconds)</Label>
                  <Input
                    id="gate-cycle-seconds"
                    type="number"
                    min={1}
                    step={1}
                    value={draft.gateCycleSeconds ?? 5}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      updateDraft({ gateCycleSeconds: Number.isFinite(v) && v >= 1 ? v : 5 })
                    }}
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    The gate script re-evaluates on this cycle until it returns TRUE.
                  </p>
                </div>
              )}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    id="gate-control-previous-action"
                    checked={draft.gateControlPreviousAction === true}
                    disabled={isReferencedSubWorkflow}
                    onChange={(e) => updateDraft({ gateControlPreviousAction: e.target.checked })}
                  />
                  Control Previous Action
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  When on, this gate starts as soon as the previous Environment Action starts, and stops that action
                  when it returns TRUE. When off, the gate waits for the previous step to complete.
                </p>
              </div>
              {draft.gateMode !== 'timer' && (
                <Button variant="outline" size="sm" onClick={() => setScriptEditorOpen(true)}>
                  Edit Script
                </Button>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Select 1 Step Configuration */}
        {nodeType === 'select1' && (
          <CollapsibleSection value="select1" title="Select-1 Configuration">
            <Select1StepConfig
              data={draft}
              nodeId={nodeId}
              onChange={(updates) => updateDraft(updates)}
              readOnly={isReferencedSubWorkflow}
            />
          </CollapsibleSection>
        )}

        {/* Resources (embedded sub-workflows) */}
        {isEmbeddedSubWorkflow && (
          <CollapsibleSection
            value="resources"
            title="Resource Definitions"
            count={(childDraft?.resources ?? []).length}
          >
            <ResourcesEditor
              resources={childDraft?.resources ?? []}
              onChange={(resources) => {
                if (childDraft) {
                  setChildDraft({ ...childDraft, resources })
                }
              }}
              readOnly={false}
              hideHeading
            />
          </CollapsibleSection>
        )}
        {isReferencedSubWorkflow && childDraft && childDraft.resources.length > 0 && (
          <CollapsibleSection value="resources" title="Resource Definitions" count={childDraft.resources.length}>
            <ResourcesEditor resources={childDraft.resources} onChange={() => {}} readOnly={true} hideHeading />
          </CollapsibleSection>
        )}

        {/* Resource Commands — editable even on referenced sub-workflows (acquire/release on proxy).
            GATE cannot hold resource commands: the engine rejects them (GATE_RESOURCES_UNSUPPORTED)
            for every gate — a gate never runs the acquire half, so it has nothing to release. */}
        {!CONTROL_FLOW_TYPES.includes(nodeType) && nodeType !== 'gateStep' && (
          <CollapsibleSection
            value="resourceCommands"
            title="Resource Commands"
            count={(draft.resourceCommands || []).length}
          >
            <ResourceCommandEditor
              resourceCommands={draft.resourceCommands || []}
              onChange={(resourceCommands) => updateDraft({ resourceCommands })}
              readOnly={false}
              hideHeading
            />
          </CollapsibleSection>
        )}

        {/* TRY / error-handling specifications (Action Proxy, Script, User Interaction, Yes/No, Workflow Proxy) */}
        {TRY_CAPABLE_NODE_TYPES.has(nodeType) && (
          <CollapsibleSection value="try" title="TRY / Error Handling" count={(draft.trySpecifications ?? []).length}>
            <TryEditor
              value={(draft.trySpecifications ?? []) as TrySpec[]}
              onChange={(ts) => updateDraft({ trySpecifications: ts })}
              availableCatches={availableCatches}
              hideHeading
            />
          </CollapsibleSection>
        )}

        {/* RETURN command configuration (return steps only) */}
        {nodeType === 'return' && (
          <CollapsibleSection value="return" title="RETURN Configuration">
            <ReturnConfigEditor
              value={draft.returnConfig as ReturnConfig | undefined}
              onChange={(rc) => updateDraft({ returnConfig: rc })}
              gotoTargets={gotoTargets}
              hideHeading
            />
          </CollapsibleSection>
        )}

        {/* CATCH id editor + "Triggered by" discoverability */}
        {nodeType === 'catch' && (
          <CollapsibleSection value="catch" title="CATCH ID">
            <CatchIdEditor
              value={currentCatchId}
              takenIds={takenCatchIds}
              onChange={(newId) => {
                useFlowStore.getState().renameCatchId(currentCatchId, newId)
                updateDraft({ catchId: newId })
              }}
              hideHeading
            />
            {currentCatchId.trim() !== '' && (
              <CatchTriggeredBy
                triggers={findCatchTriggers(allNodes, currentCatchId, workflowTries)}
                onSelect={(stepId) => useFlowStore.getState().selectNode(stepId)}
              />
            )}
          </CollapsibleSection>
        )}
      </Accordion.Root>

      {/* Script Editor Modal — lazy-loaded to keep CodeMirror out of main bundle */}
      <Suspense fallback={null}>
        <ScriptEditorModal
          open={scriptEditorOpen}
          onOpenChange={setScriptEditorOpen}
          data={draft}
          onChange={(updates) => updateDraft(updates)}
          variant={nodeType === 'gateStep' ? 'gate' : 'script'}
        />
      </Suspense>
    </>
  )
}
