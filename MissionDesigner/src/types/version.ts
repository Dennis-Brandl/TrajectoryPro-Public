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

export interface VersionHistoryEntry {
  version: string
  date: string
  account: string
  reason?: string
}

export type BumpType = 'major' | 'minor' | 'patch'

export function parseSemver(version: string): [number, number, number] {
  const parts = version.split('.').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return [1, 0, 0]
  return [parts[0], parts[1], parts[2]]
}

/** Orders two x.y.z versions numerically (negative when a < b); a malformed one reads as 1.0.0. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2]
}

export function bumpVersion(current: string, type: BumpType): string {
  const [major, minor, patch] = parseSemver(current)
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
  }
}

export function createVersionEntry(version: string, account: string, reason?: string): VersionHistoryEntry {
  return {
    version,
    date: new Date().toISOString(),
    account,
    ...(reason ? { reason } : {}),
  }
}

export function parseVersionHistory(json: string | null | undefined): VersionHistoryEntry[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
