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

import { escapeSegment } from '../ingest/carry-over.js';

export const WFCENTER_FORMAT = 'WFcenter' as const;
export const WFCENTER_FORMAT_VERSION = '1.0';
export const WFCENTERX_EXTENSION = '.WFcenterX';
export const WFCENTER_MANIFEST_EXTENSION = '.WFcenter';

export type PackageScope = 'all' | 'effective';

/** A workflow_environment link, by natural key. */
export type WfcenterEnvRef = { oid: string; version: string; state: string; source: string };

export type WfcenterWorkflowEntry = {
  file: string;
  oid: string; name: string; version: string; state: string;
  dispatchPolicy: string | null;
  /** Auto-claim override (spec 2026-08-14 D4). Absent in pre-2026-08-14 packages → null. */
  autoClaim?: boolean | null;
  effectiveFrom: string | null;
  schemaVersion: string | null;
  sourceFilename: string | null;
  checksum: string | null;
  sourceLibraryName: string | null;
  sourceLibraryOid: string | null;
  environments: WfcenterEnvRef[];
};

// environment_spec has no checksum column — do not add one here.
export type WfcenterEnvironmentEntry = {
  file: string;
  oid: string; name: string; version: string; state: string;
  effectiveFrom: string | null;
  schemaVersion: string | null;
  sourceFilename: string | null;
  sourceLibraryName: string | null;
  sourceLibraryOid: string | null;
};

export type WfcenterWorkCenter = {
  path: string;
  parentPath: string | null;
  name: string;
  description: string | null;
  sortOrder: number;
  dispatchPolicy: string;
  /** Auto-claim default (spec 2026-08-14 D4). Absent in pre-2026-08-14 packages → false. */
  autoClaim?: boolean;
  /** ISA 88 type name. Absent (pre-feature package) = no opinion; null = no type. */
  typeName?: string | null;
  workflows: WfcenterWorkflowEntry[];
  environments: WfcenterEnvironmentEntry[];
};

export type WfcenterRole = { name: string; description: string | null; isSystem: boolean };

export type WfcenterGrant = {
  workCenterPath: string;
  workflow: { oid: string; version: string; state: string };
  nodePath: string;
  role: string;
};

export type WfcenterManifest = {
  format: typeof WFCENTER_FORMAT;
  formatVersion: string;
  exportedAt: string;
  scope: PackageScope;
  warnings: string[];
  workCenters: WfcenterWorkCenter[];
};

export type WfcenterRolesFile = { roles: WfcenterRole[] };
export type WfcenterGrantsFile = { grants: WfcenterGrant[] };

/**
 * escapeSegment (shared with carry-over's node-path matching, and NOT modified here — its
 * semantics are settled and used elsewhere) neutralises '/' and '%' so the join is injective,
 * but it lets '.', '..', and '\' pass through untouched. Those are packaging-specific hazards:
 * a work center literally named '..' would otherwise contribute a bare '..' path segment
 * ('workflows/Line/../Mix...WFmaster'), which a permissive extractor resolves OUTSIDE the
 * extraction directory, and a bare '\' is read as a path separator by lenient Windows zip
 * tools. Map the whole-segment '.'/'..' cases and any backslash to their percent-encodings
 * so no on-disk path segment can ever be traversal-shaped.
 *
 * Injective by construction: '.', '..', and any input containing '\' each have a UNIQUE
 * escapeSegment output only they can produce (escapeSegment only ever inserts '%25'/'%2F',
 * so it can never itself emit a bare '.', '..', or '\'), so this second pass cannot collide
 * two different original names onto the same escaped segment.
 */
export function safeSegment(name: string): string {
  const escaped = escapeSegment(name);
  if (escaped === '.') return '%2E';
  if (escaped === '..') return '%2E%2E';
  return escaped.replace(/\\/g, '%5C');
}

/**
 * Work-center name segments → a zip directory path. Each segment is escaped, so the join
 * is injective: a work center literally named 'Fill/Cap' cannot produce the same path as a
 * 'Cap' nested under a 'Fill'.
 */
export function workCenterDir(segments: string[]): string {
  return segments.map(safeSegment).join('/');
}

type NamedEntry = { oid: string; name: string; version: string; state: string };

/**
 * Filenames for one folder's entries, positionally aligned with `entries`.
 *
 * (name, version, state) is NOT unique — the business key includes oid — so collisions are
 * real and are resolved with a -2/-3 suffix. Suffixes are assigned walking entries in oid
 * order, not input order, so the same set of rows always yields the same names no matter
 * how the query happened to sort them.
 *
 * The manifest's `file` field is authoritative; nothing may parse these names back.
 */
export function assignFilenames(entries: NamedEntry[], ext: string): string[] {
  const byOid = entries.map((_, i) => i).sort((a, b) => {
    const x = entries[a]!.oid, y = entries[b]!.oid;
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const used = new Set<string>();
  const out = new Array<string>(entries.length);
  for (const i of byOid) {
    const e = entries[i]!;
    const base = `${safeSegment(e.name)}-${safeSegment(e.version)}-${safeSegment(e.state)}`;
    let candidate = `${base}${ext}`;
    let n = 1;
    while (used.has(candidate)) { n += 1; candidate = `${base}-${n}${ext}`; }
    used.add(candidate);
    out[i] = candidate;
  }
  return out;
}
