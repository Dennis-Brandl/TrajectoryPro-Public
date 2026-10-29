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

import AdmZip from 'adm-zip';
import { DaoError } from '../dao/errors.js';

export interface ZipEntry { name: string; json?: unknown; bytes: Buffer; }

export interface ZipLimits { maxEntries: number; maxTotalUncompressedBytes: number; }

// Ingest requires an authenticated *:create steward, so the realistic risk is an
// honestly-large or accidental package, not an adversary. These caps bound decompression
// using ONLY the central-directory declared sizes (entry.header.size), read before any
// getData() — so a bomb is rejected without inflating it.
// RESIDUAL (accepted, not covered): a central directory that LIES (declares small, inflates
// huge) is not caught here — defeating that needs streaming inflation with a byte limit,
// out of scope for this threat model.
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 10_000,
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
};

export function readZipEntries(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  const zip = new AdmZip(buf);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);

  if (entries.length > limits.maxEntries) {
    throw new DaoError('INVALID_PACKAGE', `Package has too many entries (${entries.length} > ${limits.maxEntries})`);
  }
  let total = 0;
  for (const e of entries) {
    total += e.header.size; // declared uncompressed size from the central directory
    if (total > limits.maxTotalUncompressedBytes) {
      throw new DaoError('INVALID_PACKAGE', `Package decompresses beyond the ${limits.maxTotalUncompressedBytes}-byte limit`);
    }
  }

  return entries.map((e) => {
    const bytes = e.getData();
    const name = e.entryName;
    const isJson = /\.(WFmaster|WFenvir|WFcenter|json)$/i.test(name);
    let json: unknown;
    if (isJson) { try { json = JSON.parse(bytes.toString('utf8')); } catch { /* leave undefined */ } }
    return { name, json, bytes };
  });
}
