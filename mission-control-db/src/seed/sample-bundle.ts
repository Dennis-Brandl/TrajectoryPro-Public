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

export function buildWfmasterx(
  rootSpec: any,
  envLibs: { libName: string; lib: any }[] = [],
  images: { path: string; bytes: Buffer }[] = [],
): Buffer {
  const zip = new AdmZip();
  zip.addFile(`${rootSpec.local_id}.WFmaster`, Buffer.from(JSON.stringify(rootSpec), 'utf8'));
  for (const e of envLibs) zip.addFile(`environments/${e.libName}.WFenvir`, Buffer.from(JSON.stringify(e.lib), 'utf8'));
  // `path` is relative to the package's images/ dir — bare `{filename}` for UI parameter
  // images, `{imageOid}-{filename}` for form-element images (Designer buildWorkflowPackage).
  for (const img of images) zip.addFile(`images/${img.path}`, img.bytes);
  return zip.toBuffer();
}
export function buildWfenvirx(envSpec: any): Buffer {
  const zip = new AdmZip();
  zip.addFile(`${envSpec.local_id}.WFenvir`, Buffer.from(JSON.stringify(envSpec), 'utf8'));
  return zip.toBuffer();
}
