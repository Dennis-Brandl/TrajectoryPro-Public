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

/**
 * import-actions.ts — how an uploaded package's actions are reconciled with
 * the actions already stored for an environment.
 *
 * The one rule: a re-import never wipes authored state code.
 *
 *   1. Match by oid — first inside the environment, then anywhere (the old
 *      upsert moved an action whose oid lives in another environment; keep
 *      that instead of failing the upload on the primary key). A matched
 *      action is updated in place; its code, console timeout and instance
 *      history are untouched.
 *   2. Otherwise match by name (`local_id`) inside the environment — Designer
 *      emits a NEW oid for the same action after "Create New Version" or a
 *      delete-and-recreate. The existing row is re-keyed to the incoming oid:
 *      code versions, instances, execution_log and the timeout follow it.
 *      The fallback only fires when the name is unambiguous on both sides.
 *   3. Anything else is created.
 *   4. Existing actions the package no longer contains: deleted when they
 *      have neither code nor a running instance (with their terminal
 *      instance rows — the FK has no cascade); otherwise kept and stamped
 *      `orphaned_at`.
 *
 * A matched or re-keyed action that already has code gets a
 * `signature_change` flag when the incoming input/output signature differs
 * from the one the code was written against (see signature-diff.ts). The
 * baseline is captured when the flag is first raised and kept across later
 * imports until the author resolves it — so the note always reads "from the
 * code's era to now". A later import that restores the baseline clears it,
 * and so does a package that carries code for the action: that code becomes
 * the code of record for the incoming signature.
 */
import type {
  Action,
  ActionInput,
  ActionRepository,
  CodeVersionRepository,
  InstanceRepository,
  LogRepository,
  SignatureChange,
} from '@mission/autopilot-storage'
import { diffSignature } from './signature-diff.js'

export interface ImportRepos {
  actions: ActionRepository
  codeVersions: CodeVersionRepository
  instances: InstanceRepository
  log: LogRepository
}

/** Per-environment outcome; the upload route merges these into its `diff`. */
export interface ActionSyncDiff {
  added: string[]
  removed: string[]
  modified: string[]
  rekeyed: string[]
  orphaned: string[]
  signature_changed: string[]
}

export function emptyActionSyncDiff(): ActionSyncDiff {
  return { added: [], removed: [], modified: [], rekeyed: [], orphaned: [], signature_changed: [] }
}

export interface ActionSyncResult {
  /** The oid each incoming action is stored under (deduplicated, incoming order). */
  storedOids: string[]
  diff: ActionSyncDiff
}

export interface SyncOptions {
  now?: string
  /**
   * Incoming oids whose package also carries code for the action. That code
   * is saved by the caller right after the sync and becomes the code of
   * record, so no signature flag is raised against the previous baseline.
   */
  codeBearingOids?: ReadonlySet<string>
}

/**
 * Package data carries no console-owned fields (the bundle export does write
 * `timeout_seconds`, but no import path has ever read it); strip them so an
 * update can't clobber the stored values.
 */
function packageFields(incoming: ActionInput): ActionInput {
  const fields: ActionInput = { ...incoming }
  delete fields.timeout_seconds
  delete fields.signature_change
  delete fields.orphaned_at
  return fields
}

async function signatureFlagFor(
  repos: ImportRepos,
  existing: Action,
  incoming: ActionInput,
  now: string,
  carriesCode: boolean
): Promise<SignatureChange | null> {
  if (carriesCode) return null
  const hasCode = (await repos.codeVersions.countByAction(existing.oid)) > 0
  if (!hasCode) return null
  const prior = existing.signature_change
  const baselineInputs =
    prior?.baseline_input_parameter_specifications ?? existing.input_parameter_specifications
  const baselineOutputs =
    prior?.baseline_output_parameter_specifications ?? existing.output_parameter_specifications
  const changes = diffSignature(
    baselineInputs,
    baselineOutputs,
    incoming.input_parameter_specifications,
    incoming.output_parameter_specifications
  )
  if (changes.length === 0) return null
  return {
    flagged_at: prior?.flagged_at ?? now,
    baseline_input_parameter_specifications: baselineInputs,
    baseline_output_parameter_specifications: baselineOutputs,
    changes,
  }
}

async function updateMatched(
  repos: ImportRepos,
  existing: Action,
  incoming: ActionInput,
  now: string,
  carriesCode: boolean
): Promise<SignatureChange | null> {
  const flag = await signatureFlagFor(repos, existing, incoming, now, carriesCode)
  await repos.actions.update(existing.oid, {
    ...packageFields(incoming),
    signature_change: flag,
    orphaned_at: null,
  })
  return flag
}

async function rekey(
  repos: ImportRepos,
  existing: Action,
  incoming: ActionInput,
  now: string,
  carriesCode: boolean
): Promise<SignatureChange | null> {
  const flag = await signatureFlagFor(repos, existing, incoming, now, carriesCode)
  // New parent first, children re-pointed, old parent last: code_versions'
  // ON DELETE CASCADE never fires and instances' FK (no cascade) stays
  // satisfied throughout. A state execution already in flight for the old
  // oid at this instant reads its action row by the old oid once more and
  // falls back to defaults for that one state — a window of a few ms.
  await repos.actions.create({
    ...packageFields(incoming),
    timeout_seconds: existing.timeout_seconds,
    signature_change: flag,
    orphaned_at: null,
  })
  await repos.codeVersions.reassignAction(existing.oid, incoming.oid)
  await repos.instances.reassignAction(existing.oid, incoming.oid)
  await repos.log.reassignAction(existing.oid, incoming.oid)
  await repos.actions.delete(existing.oid)
  return flag
}

function groupByName<T extends { local_id: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const group = groups.get(row.local_id)
    if (group) group.push(row)
    else groups.set(row.local_id, [row])
  }
  return groups
}

async function hasActiveInstance(repos: ImportRepos, actionOid: string): Promise<boolean> {
  const instances = await repos.instances.findByAction(actionOid)
  return instances.some((i) => i.completed_at === null)
}

/**
 * Reconciles every action of one environment package. Runs inside the
 * upload transaction; `now` is injectable for tests.
 */
export async function syncEnvironmentActions(
  repos: ImportRepos,
  environmentOid: string,
  incoming: ActionInput[],
  options: SyncOptions = {}
): Promise<ActionSyncResult> {
  const now = options.now ?? new Date().toISOString()
  const codeBearing = options.codeBearingOids ?? new Set<string>()

  const existing = await repos.actions.findByEnvironment(environmentOid)
  const existingByOid = new Map(existing.map((a) => [a.oid, a]))

  // Oid matches: this environment first, then any environment.
  const matchedByOid = new Map<string, Action>() // incoming oid → stored row
  for (const action of incoming) {
    if (matchedByOid.has(action.oid)) continue
    const row = existingByOid.get(action.oid) ?? (await repos.actions.findByOid(action.oid))
    if (row) matchedByOid.set(action.oid, row)
  }
  const matchedExistingOids = new Set([...matchedByOid.values()].map((a) => a.oid))

  // Name fallback: pair an unmatched existing row with an unmatched incoming
  // one only when that name is unique on both sides.
  const existingByName = groupByName(existing.filter((a) => !matchedExistingOids.has(a.oid)))
  const incomingByName = groupByName(incoming.filter((a) => !matchedByOid.has(a.oid)))
  const rekeySource = new Map<string, Action>() // incoming oid → existing row
  for (const [name, candidates] of incomingByName) {
    const sources = existingByName.get(name)
    if (candidates.length === 1 && sources?.length === 1) {
      rekeySource.set(candidates[0]!.oid, sources[0]!)
    }
  }
  const rekeyedExistingOids = new Set([...rekeySource.values()].map((a) => a.oid))

  const diff = emptyActionSyncDiff()
  const storedOids: string[] = []
  const seen = new Set<string>()

  for (const action of incoming) {
    if (seen.has(action.oid)) {
      // A package listing the same oid twice: last one wins, as upsert did.
      await repos.actions.update(action.oid, packageFields(action))
      continue
    }
    seen.add(action.oid)
    storedOids.push(action.oid)
    const carriesCode = codeBearing.has(action.oid)

    const byOid = matchedByOid.get(action.oid)
    if (byOid) {
      const flag = await updateMatched(repos, byOid, action, now, carriesCode)
      if (byOid.environment_oid !== environmentOid) diff.added.push(action.local_id)
      else if (byOid.version !== action.version) diff.modified.push(action.local_id)
      if (flag) diff.signature_changed.push(action.local_id)
      continue
    }

    const byName = rekeySource.get(action.oid)
    if (byName) {
      const flag = await rekey(repos, byName, action, now, carriesCode)
      diff.rekeyed.push(action.local_id)
      if (flag) diff.signature_changed.push(action.local_id)
      continue
    }

    await repos.actions.create(packageFields(action))
    diff.added.push(action.local_id)
  }

  for (const row of existing) {
    if (matchedExistingOids.has(row.oid) || rekeyedExistingOids.has(row.oid)) continue
    const hasCode = (await repos.codeVersions.countByAction(row.oid)) > 0
    if (hasCode || (await hasActiveInstance(repos, row.oid))) {
      if (!row.orphaned_at) await repos.actions.update(row.oid, { orphaned_at: now })
      diff.orphaned.push(row.local_id)
    } else {
      await repos.instances.deleteByAction(row.oid)
      await repos.codeVersions.deleteByAction(row.oid)
      await repos.actions.delete(row.oid)
      diff.removed.push(row.local_id)
    }
  }

  return { storedOids, diff }
}

export interface ActionImportResult {
  created: boolean
  /** The oid the row was re-keyed from, when the name fallback fired. */
  rekeyedFrom: string | null
  signatureChanged: boolean
}

export interface ImportActionOptions {
  now?: string
  /** The package carries code for this action (see SyncOptions.codeBearingOids). */
  carriesCode?: boolean
}

/** Reconciles a single standalone action (.WFaction / .WFactionCodeX). Same rules, no orphan pass. */
export async function importAction(
  repos: ImportRepos,
  incoming: ActionInput,
  options: ImportActionOptions = {}
): Promise<ActionImportResult> {
  const now = options.now ?? new Date().toISOString()
  const carriesCode = options.carriesCode ?? false

  const byOid = await repos.actions.findByOid(incoming.oid)
  if (byOid) {
    const flag = await updateMatched(repos, byOid, incoming, now, carriesCode)
    return { created: false, rekeyedFrom: null, signatureChanged: flag !== null }
  }
  if (incoming.environment_oid) {
    const sameName = (await repos.actions.findByEnvironment(incoming.environment_oid)).filter(
      (a) => a.local_id === incoming.local_id
    )
    if (sameName.length === 1) {
      const source = sameName[0]!
      const flag = await rekey(repos, source, incoming, now, carriesCode)
      return { created: false, rekeyedFrom: source.oid, signatureChanged: flag !== null }
    }
  }
  await repos.actions.create(packageFields(incoming))
  return { created: true, rekeyedFrom: null, signatureChanged: false }
}
