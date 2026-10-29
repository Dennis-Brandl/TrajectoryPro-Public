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

import { expect, test } from 'vitest';
import AdmZip from 'adm-zip';
import { readZipEntries } from './zip.js';
import { DaoError } from '../dao/errors.js';

function zipOf(files: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, body] of Object.entries(files)) zip.addFile(name, Buffer.from(body, 'utf8'));
  return zip.toBuffer();
}

test('reads entries under the limits', () => {
  const buf = zipOf({ 'a.json': '{"x":1}', 'b.txt': 'hello' });
  const entries = readZipEntries(buf);
  expect(entries.map((e) => e.name).sort()).toEqual(['a.json', 'b.txt']);
});

test('rejects when the entry count exceeds maxEntries', () => {
  const buf = zipOf({ 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c' });
  expect(() => readZipEntries(buf, { maxEntries: 2, maxTotalUncompressedBytes: 1 << 30 }))
    .toThrow(DaoError);
});

test('rejects when the total declared uncompressed size exceeds the cap', () => {
  const buf = zipOf({ 'a.txt': 'aaaaaaaaaa', 'b.txt': 'bbbbbbbbbb' }); // 20 bytes total
  expect(() => readZipEntries(buf, { maxEntries: 1000, maxTotalUncompressedBytes: 15 }))
    .toThrow(DaoError);
});
