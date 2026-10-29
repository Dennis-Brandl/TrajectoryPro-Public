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

import type { ParameterSpec } from '@/types/nodes'

/** The part of an action spec / step node that carries a parameter signature. */
export interface ParameterSignature {
  inputs?: ParameterSpec[]
  outputs?: ParameterSpec[]
}

export interface SignatureSideDiff {
  added: string[]
  removed: string[]
  changed: string[]
}

export interface SignatureDiff {
  inputs: SignatureSideDiff
  outputs: SignatureSideDiff
}

interface NormalizedRow {
  name: string
  description: string
  schema: string
}

function entryValue(row: ParameterSpec, entryName: string): string | undefined {
  return row.entries?.find((e) => e.name === entryName)?.value
}

/** Rows may be ParameterSpec-shaped (description/value) or ValueSpec-shaped (entries) —
 *  ActionDetailView migrates action rows to the latter; extractInputParams reads both.
 *  Returns null for an unnamed row. */
export function normalizeRow(row: ParameterSpec): NormalizedRow | null {
  if (!row.name) return null
  return {
    name: row.name,
    description: row.description ?? entryValue(row, 'Description') ?? '',
    schema: row.schema ?? '',
  }
}

function normalizeRows(rows: ParameterSpec[] | undefined): Map<string, NormalizedRow> {
  const byName = new Map<string, NormalizedRow>()
  for (const row of rows ?? []) {
    const n = normalizeRow(row)
    if (n && !byName.has(n.name)) byName.set(n.name, n)
  }
  return byName
}

function diffSide(
  node: ParameterSpec[] | undefined,
  action: ParameterSpec[] | undefined,
  compareSchema: boolean,
): SignatureSideDiff {
  const before = normalizeRows(node)
  const after = normalizeRows(action)
  const added = [...after.keys()].filter((name) => !before.has(name))
  const removed = [...before.keys()].filter((name) => !after.has(name))
  const changed = [...after.keys()].filter((name) => {
    const a = before.get(name)
    const b = after.get(name)!
    return !!a && (a.description !== b.description || (compareSchema && a.schema !== b.schema))
  })
  return { added, removed, changed }
}

const isEmpty = (d: SignatureSideDiff) => d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0

/** Spec 2026-09-04 §6.2: by name, order-insensitive; null when the node matches the action. */
export function actionSignatureDiff(node: ParameterSignature, action: ParameterSignature): SignatureDiff | null {
  const diff: SignatureDiff = {
    inputs: diffSide(node.inputs, action.inputs, true),
    outputs: diffSide(node.outputs, action.outputs, false),
  }
  return isEmpty(diff.inputs) && isEmpty(diff.outputs) ? null : diff
}

/** D8: the action's rows (cloned, action order, action ids); by name, inputs keep the node's
 *  value/valueType when defined and outputs keep the node's target when defined; node rows
 *  absent from the action are dropped. The same rule the import path has always applied. */
export function mergeActionSignature(
  node: ParameterSignature,
  action: ParameterSignature,
): { inputs: ParameterSpec[]; outputs: ParameterSpec[] } {
  const inputs = (action.inputs ?? []).map((row) => {
    const merged: ParameterSpec = structuredClone(row)
    const match = (node.inputs ?? []).find((n) => n.name === row.name)
    if (match) {
      if (match.value !== undefined) merged.value = match.value
      if (match.valueType !== undefined) merged.valueType = match.valueType
    }
    return merged
  })
  const outputs = (action.outputs ?? []).map((row) => {
    const merged: ParameterSpec = structuredClone(row)
    const match = (node.outputs ?? []).find((n) => n.name === row.name)
    if (match?.target) merged.target = match.target
    return merged
  })
  return { inputs, outputs }
}

function sideSummary(label: string, d: SignatureSideDiff): string | null {
  const terms: string[] = []
  if (d.added.length > 0) terms.push(`+${d.added.length}`)
  if (d.removed.length > 0) terms.push(`−${d.removed.length}`)
  if (d.changed.length > 0) terms.push(`~${d.changed.length}`)
  return terms.length > 0 ? `${label}: ${terms.join(' ')}` : null
}

/** `Inputs: +2 −1 ~1 · Outputs: +1` — zero terms and empty sides omitted. */
export function summarizeSignatureDiff(diff: SignatureDiff): string {
  return [sideSummary('Inputs', diff.inputs), sideSummary('Outputs', diff.outputs)]
    .filter((s): s is string => !!s)
    .join(' · ')
}
