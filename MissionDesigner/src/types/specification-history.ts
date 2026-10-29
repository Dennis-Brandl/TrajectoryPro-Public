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

import type { SpecificationState } from '@/types/library'

export type SpecificationHistoryEntry =
  | { type: 'created'; at: string; account: string; version: string }
  | {
      type: 'state_change'
      at: string
      account: string
      version: string
      fromState: SpecificationState
      toState: SpecificationState
      reason: string
      /** True when an administrator forced an edge that is not in the legal table (design D14). */
      adminOverride?: boolean
      /** True for entries written by the auto-supersede sweep, not a user. */
      system?: boolean
      /** Unix-ms scheduled in-force date — recorded on transitions to Effective. */
      effectiveFrom?: number
    }
  | {
      type: 'new_version'
      at: string
      account: string
      version: string
      fromVersion: string
      fromSpecId: string
    }

export function parseHistory(json: string | null | undefined): SpecificationHistoryEntry[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as SpecificationHistoryEntry[]) : []
  } catch {
    return []
  }
}

export function serializeHistory(entries: SpecificationHistoryEntry[]): string {
  return JSON.stringify(entries)
}

function nowIso(): string {
  return new Date().toISOString()
}

export function createCreatedEntry(args: {
  account: string
  version: string
}): Extract<SpecificationHistoryEntry, { type: 'created' }> {
  return { type: 'created', at: nowIso(), account: args.account, version: args.version }
}

export function createStateChangeEntry(args: {
  account: string
  version: string
  fromState: SpecificationState
  toState: SpecificationState
  reason: string
  adminOverride?: boolean
  system?: boolean
  effectiveFrom?: number
}): Extract<SpecificationHistoryEntry, { type: 'state_change' }> {
  return {
    type: 'state_change',
    at: nowIso(),
    account: args.account,
    version: args.version,
    fromState: args.fromState,
    toState: args.toState,
    reason: args.reason,
    ...(args.adminOverride ? { adminOverride: true } : {}),
    ...(args.system ? { system: true } : {}),
    ...(args.effectiveFrom !== undefined ? { effectiveFrom: args.effectiveFrom } : {}),
  }
}

export function createNewVersionEntry(args: {
  account: string
  version: string
  fromVersion: string
  fromSpecId: string
}): Extract<SpecificationHistoryEntry, { type: 'new_version' }> {
  return {
    type: 'new_version',
    at: nowIso(),
    account: args.account,
    version: args.version,
    fromVersion: args.fromVersion,
    fromSpecId: args.fromSpecId,
  }
}
