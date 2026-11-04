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

// @vitest-environment node

// A .WFlibX import must put each form image into its spec's `data.images`: the form designer
// and the library re-export read pictures only from there.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import JSZip from 'jszip'
import { setupTestFixture, resetAndSeedFixture, mockSessionAs, rawQuery, type TestFixture } from './testSeed'

let f: TestFixture

beforeAll(async () => {
  f = await setupTestFixture()
})

beforeEach(async () => {
  await resetAndSeedFixture(f)
  mockSessionAs(f.userIdGlobal)
})

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const png = (marker: number) => Uint8Array.from([...PNG, marker, marker, marker])
const dataUri = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`

interface Block {
  src: string
  imageOid?: string
}

function workflow(oid: string, block: Block) {
  return {
    oid,
    local_id: oid,
    version: '1.0.0',
    connections: [],
    steps: [
      {
        oid: `${oid}-step`,
        local_id: 'Show',
        version: '1.0.0',
        step_type: 'USER_INTERACTION',
        form_document: {
          version: 2,
          sections: [
            {
              id: 's1',
              role: 'content',
              rows: [{ id: 'r1', blocks: [{ id: 'b1', type: 'image', layout: { aspectRatio: '16/9' }, ...block }] }],
            },
          ],
        },
      },
    ],
  }
}

async function makeBundle(specs: Array<ReturnType<typeof workflow>>, images: Record<string, Uint8Array>) {
  const zip = new JSZip()
  zip.file(
    'manifest.json',
    JSON.stringify({
      packageType: 'workflow-library',
      packageVersion: '1.1',
      libraryName: 'Pictures',
      createdAt: new Date().toISOString(),
      files: [{ path: 'Pictures.WFlib', type: 'workflow-library' }],
      oidIndex: {
        libraries: [{ oid: 'PL', name: 'Pictures', entityType: 'workflow', version: '1.0.0' }],
        specifications: specs.map((s) => ({ oid: s.oid, libraryOid: 'PL', name: s.local_id, version: '1.0.0' })),
      },
    }),
  )
  zip.file(
    'Pictures.WFlib',
    JSON.stringify({ oid: 'PL', local_id: 'Pictures', version: '1.0.0', workflow_specifications: specs }),
  )
  for (const [name, bytes] of Object.entries(images)) zip.file(`images/${name}`, bytes)
  return zip.generateAsync({ type: 'uint8array' })
}

async function previewBundle(bytes: Uint8Array) {
  const form = new FormData()
  form.append('file', new File([bytes.buffer as ArrayBuffer], 'bundle.WFlibX', { type: 'application/zip' }))
  const preview = await f.app.request('/api/v2/packages/workflow-library/preview', {
    method: 'POST',
    headers: { origin: 'http://localhost:5173' },
    body: form,
  })
  expect(preview.status).toBe(200)
  return (await preview.json()) as { previewId: string; rows: Array<{ bundleOid: string; status: { tag: string } }> }
}

async function importBundle(bytes: Uint8Array, resolutions: Record<string, 'keep' | 'replace'> = {}) {
  const { previewId } = await previewBundle(bytes)
  const commit = await f.app.request('/api/v2/packages/workflow-library/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify({ teamId: f.teamMainId, previewId, resolutions }),
  })
  expect(commit.status).toBe(200)
  return (await commit.json()) as { warnings: string[]; replaced: { specifications: number } }
}

async function imagesOf(specId: string) {
  const [row] = await rawQuery<{ data: string | Record<string, unknown> }>(
    'SELECT data FROM "specification" WHERE id = $1',
    [specId],
  )
  const data = typeof row.data === 'string' ? (JSON.parse(row.data) as Record<string, unknown>) : row.data
  return data.images as Record<string, string> | undefined
}

async function imageRowBytes(specId: string, filename: string) {
  const [row] = await rawQuery<{ data: Uint8Array }>(
    `SELECT ib.data FROM image i JOIN image_blob ib ON ib."contentHash" = i."contentHash"
      WHERE i."specificationId" = $1 AND i.filename = $2`,
    [specId, filename],
  )
  return Buffer.from(row.data).toString('hex')
}

describe('.WFlibX import: form images', () => {
  it('puts an oid-prefixed package image into the spec under the name the form uses', async () => {
    const bytes = png(1)
    await importBundle(
      await makeBundle([workflow('W1', { src: 'Failure.png', imageOid: '111' })], { '111-Failure.png': bytes }),
    )
    expect(await imagesOf('W1')).toEqual({ 'Failure.png': dataUri(bytes) })
  })

  it('finds an image stored under its bare filename', async () => {
    const bytes = png(2)
    await importBundle(await makeBundle([workflow('W1', { src: 'bare.png' })], { 'bare.png': bytes }))
    expect(await imagesOf('W1')).toEqual({ 'bare.png': dataUri(bytes) })
  })

  it('gives two workflows their own picture when both files have the same name', async () => {
    const first = png(3)
    const second = png(4)
    await importBundle(
      await makeBundle(
        [workflow('W1', { src: 'Logo.png', imageOid: '111' }), workflow('W2', { src: 'Logo.png', imageOid: '222' })],
        { '111-Logo.png': first, '222-Logo.png': second, 'Logo.png': first },
      ),
    )
    expect(await imagesOf('W1')).toEqual({ 'Logo.png': dataUri(first) })
    expect(await imagesOf('W2')).toEqual({ 'Logo.png': dataUri(second) })
    // Pilot's package is built from the image rows, so they must agree with the editor.
    expect(await imageRowBytes('W1', 'Logo.png')).toBe(Buffer.from(first).toString('hex'))
    expect(await imageRowBytes('W2', 'Logo.png')).toBe(Buffer.from(second).toString('hex'))
  })

  it('carries the images on a conflict resolved by replacing', async () => {
    await importBundle(await makeBundle([workflow('W1', { src: 'A.png', imageOid: '111' })], {}))
    expect(await imagesOf('W1')).toBeUndefined()

    const bytes = png(5)
    // Same name in the same library under a new OID is what makes a conflict.
    const next = await makeBundle([{ ...workflow('W9', { src: 'A.png', imageOid: '111' }), local_id: 'W1' }], {
      '111-A.png': bytes,
    })
    const plan = await previewBundle(next)
    expect(plan.rows.find((r) => r.bundleOid === 'W9')?.status.tag).toBe('conflict')
    const report = await importBundle(next, { W9: 'replace' })
    expect(report.replaced.specifications).toBe(1)
    expect(await imagesOf('W9')).toEqual({ 'A.png': dataUri(bytes) })
  })

  it('leaves out a file that is not really an image and warns once', async () => {
    const fake = new TextEncoder().encode('<script>alert(1)</script>')
    const report = await importBundle(
      await makeBundle([workflow('W1', { src: 'evil.png', imageOid: '111' })], { '111-evil.png': fake }),
    )
    expect(await imagesOf('W1')).toBeUndefined()
    expect(report.warnings.filter((w) => w.includes('evil.png'))).toHaveLength(1)
  })

  it('ignores web addresses, the empty placeholder and images missing from the package', async () => {
    const specs = [
      workflow('W1', { src: 'https://example.com/a.png' }),
      workflow('W2', { src: 'No image selected' }),
      workflow('W3', { src: 'gone.png', imageOid: '333' }),
    ]
    await importBundle(await makeBundle(specs, {}))
    expect(await imagesOf('W1')).toBeUndefined()
    expect(await imagesOf('W2')).toBeUndefined()
    expect(await imagesOf('W3')).toBeUndefined()
  })
})
