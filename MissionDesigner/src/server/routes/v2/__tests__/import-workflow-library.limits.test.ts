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

// Task 8 (data-safety): .WFlibX upload/zip limits and the image file-type check.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import JSZip from 'jszip'
import {
  MAX_IMPORT_REQUEST_BYTES,
  MAX_IMPORT_ENTRIES,
  MAX_IMPORT_PER_ENTRY_BYTES,
  MAX_IMPORT_ZIP_BYTES,
} from '../../../limits'
import { setupTestFixture, resetAndSeedFixture, mockSessionAs, rawQuery, type TestFixture } from './testSeed'

let f: TestFixture

beforeAll(async () => {
  f = await setupTestFixture()
})

beforeEach(async () => {
  await resetAndSeedFixture(f)
  mockSessionAs(f.userIdGlobal)
})

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

function manifestFor(libName: string, libOid: string, specOid: string): string {
  return JSON.stringify({
    packageType: 'workflow-library',
    packageVersion: '1.1',
    libraryName: libName,
    createdAt: new Date().toISOString(),
    files: [{ path: `${libName}.WFlib`, type: 'workflow-library' }],
    oidIndex: {
      libraries: [{ oid: libOid, name: libName, entityType: 'workflow', version: '1.0.0' }],
      specifications: [{ oid: specOid, libraryOid: libOid, name: 'Spec', version: '1.0.0' }],
    },
  })
}

/** A one-step workflow library whose form shows the named image; `images` become images/<name> entries. */
async function makeImageLib(imageSrc: string, images: Record<string, Buffer>): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('manifest.json', manifestFor('ImgLib', 'IL1', 'IS1'))
  zip.file(
    'ImgLib.WFlib',
    JSON.stringify({
      oid: 'IL1',
      local_id: 'ImgLib',
      version: '1.0.0',
      workflow_specifications: [
        {
          oid: 'IS1',
          local_id: 'Spec',
          version: '1.0.0',
          connections: [],
          steps: [
            {
              local_id: 's1',
              oid: 'S1',
              version: '1.0.0',
              last_modified_date: '2026-07-23T00:00:00.000Z',
              step_type: 'USER_INTERACTION',
              form_document: {
                version: 2,
                sections: [
                  {
                    id: 'content',
                    role: 'content',
                    rows: [
                      {
                        id: 'r1',
                        blocks: [
                          { id: 'b1', type: 'image', src: imageSrc, imageOid: 'O1', layout: { aspectRatio: '16/9' } },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
  )
  for (const [name, bytes] of Object.entries(images)) zip.file(`images/${name}`, bytes)
  return zip.generateAsync({ type: 'uint8array' })
}

async function postPreview(bytes: Uint8Array): Promise<Response> {
  const form = new FormData()
  form.append('file', new File([bytes.buffer as ArrayBuffer], 'bundle.WFlibX', { type: 'application/zip' }))
  return f.app.request('/api/v2/packages/workflow-library/preview', {
    method: 'POST',
    headers: { origin: 'http://localhost:5173' },
    body: form,
  })
}

async function commit(previewId: string): Promise<Response> {
  return f.app.request('/api/v2/packages/workflow-library/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify({ previewId, resolutions: {}, teamId: f.teamMainId }),
  })
}

describe('POST /packages/workflow-library/preview — limits', () => {
  it('rejects an upload over MAX_IMPORT_ZIP_BYTES with 413 zip_too_large', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array(MAX_IMPORT_ZIP_BYTES + 1)], 'big.WFlibX'))
    const res = await f.app.request('/api/v2/packages/workflow-library/preview', {
      method: 'POST',
      headers: { origin: 'http://localhost:5173' },
      body: form,
    })
    expect(res.status).toBe(413)
    expect(((await res.json()) as { code: string }).code).toBe('zip_too_large')
  })

  it('rejects a zip bomb (one entry inflating past the per-entry cap) with 413', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', manifestFor('B', 'B1', 'BS1'))
    zip.file('images/bomb.png', Buffer.alloc(MAX_IMPORT_PER_ENTRY_BYTES + 1), {
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    })
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    expect(bytes.length).toBeLessThan(1024 * 1024)
    const res = await postPreview(bytes)
    expect(res.status).toBe(413)
    expect(((await res.json()) as { code: string }).code).toBe('zip_entry_too_large')
  })

  it('rejects a zip with too many entries with 413', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', manifestFor('B', 'B1', 'BS1'))
    for (let i = 0; i < MAX_IMPORT_ENTRIES + 1; i++) zip.file(`images/f${i}.png`, 'x')
    const res = await postPreview(await zip.generateAsync({ type: 'uint8array' }))
    expect(res.status).toBe(413)
    expect(((await res.json()) as { code: string }).code).toBe('zip_too_many_entries')
  })
})

describe('import routes — request body limit', () => {
  it.each(['/api/v2/packages/workflow-library/preview', '/api/v2/packages/import'])(
    '%s refuses an oversized request before reading its body',
    async (url) => {
      const res = await f.app.request(url, {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'multipart/form-data; boundary=x',
          'content-length': String(MAX_IMPORT_REQUEST_BYTES + 1),
        },
        body: '--x--',
      })
      expect(res.status).toBe(413)
      expect(((await res.json()) as { code: string }).code).toBe('zip_too_large')
    },
  )
})

describe('POST /packages/workflow-library/commit — image file type', () => {
  it('skips an SVG image and reports the exact warning', async () => {
    const plan = (await (await postPreview(await makeImageLib('logo.svg', { 'logo.svg': SVG }))).json()) as {
      previewId: string
    }
    const res = await commit(plan.previewId)
    expect(res.status).toBe(200)
    const report = (await res.json()) as { warnings: string[] }
    expect(report.warnings).toContain('Skipped image "logo.svg": not a PNG, JPEG, WebP or GIF image.')
    const rows = await rawQuery('SELECT filename FROM "image"')
    expect(rows).toHaveLength(0)
  })

  it('stores a PNG named .jpg as image/png', async () => {
    const plan = (await (await postPreview(await makeImageLib('pic.jpg', { 'pic.jpg': PNG }))).json()) as {
      previewId: string
    }
    const res = await commit(plan.previewId)
    expect(res.status).toBe(200)
    const rows = await rawQuery<{ mimeType: string }>('SELECT "mimeType" FROM "image" WHERE filename = $1', ['pic.jpg'])
    expect(rows.map((r) => r.mimeType)).toEqual(['image/png'])
    const blobs = await rawQuery<{ mimeType: string }>('SELECT "mimeType" FROM "image_blob"')
    expect(blobs.map((r) => r.mimeType)).toEqual(['image/png'])
  })
})
