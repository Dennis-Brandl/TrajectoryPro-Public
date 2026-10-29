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

import type { ZipEntry } from './zip.js';

// Extraction of a .WFmasterX package's images/ entries into workflow_image rows.
//
// Designer's export (buildWorkflowPackage.ts) writes two kinds of entry:
//   images/{filename}             — UI parameter images (ui_parameter_specifications type 'Image')
//   images/{imageOid}-{filename}  — form-element image blocks (prefix falls back to the STEP oid
//                                   when a block has no imageOid)
// while the form_document `src` (and the UI param `value`) stay the BARE filename. Resolution
// therefore mirrors Designer's own import precedence (injectSpecImages.ts resolveImageBytes):
// exact bare filename first, known-oid prefix second, `-{filename}` suffix match last.
//
// Same degrade-to-noop stance as the rest of the ingest walkers: anything malformed is
// skipped, never thrown — a package without images (or with unresolvable refs) loads fine
// and the Pilot shows the renderer's placeholder for what's missing.

export interface WorkflowImageRow { filename: string; mimeType: string; dataBase64: string }

interface ImageRef { filename: string; imageOid: string | null }

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
};

function mimeForFilename(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/** External/empty/authoring-placeholder refs carry no packaged bytes — skip them. */
function isPackagedRef(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
    && !value.startsWith('http://') && !value.startsWith('https://')
    && !value.startsWith('data:') && value !== 'No image selected';
}

/** Walk one spec's steps for image references: form_document image blocks + Image UI params. */
function collectFromSteps(steps: unknown, out: ImageRef[]): void {
  if (!Array.isArray(steps)) return;
  for (const step of steps as Array<Record<string, unknown> | null>) {
    if (!step || typeof step !== 'object') continue;
    const params = step.ui_parameter_specifications;
    if (Array.isArray(params)) {
      for (const p of params as Array<Record<string, unknown> | null>) {
        if (p?.type === 'Image' && isPackagedRef(p.value)) out.push({ filename: p.value, imageOid: null });
      }
    }
    const doc = step.form_document as Record<string, unknown> | undefined;
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.sections)) continue;
    for (const section of doc.sections as Array<Record<string, unknown> | null>) {
      const rows = section && typeof section === 'object' ? section.rows : undefined;
      if (!Array.isArray(rows)) continue;
      for (const row of rows as Array<Record<string, unknown> | null>) {
        const blocks = row && typeof row === 'object' ? row.blocks : undefined;
        if (!Array.isArray(blocks)) continue;
        for (const block of blocks as Array<Record<string, unknown> | null>) {
          if (!block || typeof block !== 'object' || block.type !== 'image') continue;
          if (!isPackagedRef(block.src)) continue;
          out.push({ filename: block.src, imageOid: typeof block.imageOid === 'string' ? block.imageOid : null });
        }
      }
    }
  }
}

/** Root + every (recursive) embedded child. */
export function collectImageRefs(root: unknown): ImageRef[] {
  const refs: ImageRef[] = [];
  const visit = (spec: unknown): void => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return;
    const s = spec as Record<string, unknown>;
    collectFromSteps(s.steps, refs);
    if (Array.isArray(s.children)) for (const c of s.children) visit(c);
  };
  visit(root);
  return refs;
}

/** Resolve every referenced filename to its bytes in the package. One row per distinct
 *  bare filename (the form_document src key) — first resolution wins. */
export function resolveImageRows(root: unknown, entries: ZipEntry[]): WorkflowImageRow[] {
  const refs = collectImageRefs(root);
  if (refs.length === 0) return [];

  const byPath = new Map<string, Buffer>();
  for (const e of entries) {
    const m = /^images\/(.+)$/.exec(e.name);
    if (m) byPath.set(m[1], e.bytes);
  }
  if (byPath.size === 0) return [];

  const rows = new Map<string, WorkflowImageRow>();
  for (const ref of refs) {
    if (rows.has(ref.filename)) continue;
    let bytes = byPath.get(ref.filename);
    if (!bytes && ref.imageOid) bytes = byPath.get(`${ref.imageOid}-${ref.filename}`);
    if (!bytes) {
      const suffix = `-${ref.filename}`;
      for (const [path, b] of byPath) { if (path.endsWith(suffix)) { bytes = b; break; } }
    }
    if (!bytes) continue;
    rows.set(ref.filename, {
      filename: ref.filename,
      mimeType: mimeForFilename(ref.filename),
      dataBase64: bytes.toString('base64'),
    });
  }
  return [...rows.values()];
}
