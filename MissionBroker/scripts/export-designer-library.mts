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

// Export the GLOBAL "Distributed Workflow Action Library", its environment library and the
// "Distributed Workflow Management" Single Environment Package into MissionBroker/designer-library/.
// It runs Mission Designer's own exporters (the code behind Designer's Export buttons) on the
// specifications read from Designer's Postgres container, so no Designer login is needed.
// Run from MissionDesigner/ so the "@/..." imports resolve:
//
//   cd MissionDesigner
//   TSX_TSCONFIG_PATH=tsconfig.app.json npx tsx ../MissionBroker/scripts/export-designer-library.mts [outDir]

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createLibraryPackage, getLibraryPackageExtension } from '@/lib/packageFormat/library-package';
import { exportEnvironmentSpec, exportEnvironmentPackage } from '@/lib/packageFormat/library-exporters';
import { specToManagedElement } from '@/lib/packageFormat/entity-converters';
import { extractInputParams, extractOutputParams, extractPropertySpecs } from '@/lib/packageFormat/parameter-extractors';
import type { MasterActionSpecification } from '@/lib/packageFormat/export-types';
import { withVersionSuffix } from '@/lib/export/filename';
import type { Library, Specification } from '@/types/library';
import type { LibraryWithChildren } from '@/lib/packageFormat/export-types';

// Verbatim copy of single-spec-exporters.ts specToMasterAction (module-private there).
function specToMasterAction(spec: Specification): MasterActionSpecification {
  return {
    ...specToManagedElement(spec),
    input_parameter_specifications: extractInputParams(spec.data),
    output_parameter_specifications: extractOutputParams(spec.data),
    property_specifications: extractPropertySpecs(spec.data),
    action_visibility: (spec.data.actionVisibility as 'opaque' | 'observable') || 'opaque',
  }
}

const outDir = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'designer-library');
const sql = (q: string) => JSON.parse(execFileSync('docker', ['exec', 'missiondesigner-mission-designer-postgres-1',
  'psql', '-U', 'mission', '-d', 'mission_designer', '-Atc', q], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim() || '[]');
const arr = (t: string | null) => (t ? JSON.parse(t) : null);

const libraries: Library[] = sql(`select coalesce(json_agg(l),'[]') from library l`).map((l: any) => ({
  ...l, environmentLibraryIds: arr(l.environmentLibraryIds), createdAt: Number(l.createdAt), updatedAt: Number(l.updatedAt),
}));
const ACTION_LIB = '73551f50-c6f2-4285-bbb3-72ae98c01da5', ENV_LIB = '7304706b-3456-49dd-a14b-c5869c6abafb';
const specs: Specification[] = sql(`select coalesce(json_agg(s order by s.name),'[]') from specification s
  where s."libraryId" in ('${ACTION_LIB}','${ENV_LIB}') and s."parentSpecificationId" is null`).map((s: any) => ({
  ...s, data: JSON.parse(s.data), history: JSON.parse(s.history ?? '[]'), environmentLibraryIds: arr(s.environmentLibraryIds),
  createdAt: Number(s.createdAt), updatedAt: Number(s.updatedAt),
}));
const byLib = new Map<string, Specification[]>();
for (const s of specs) byLib.set(s.libraryId, [...(byLib.get(s.libraryId) ?? []), s]);

mkdirSync(outDir, { recursive: true });
const save = async (blob: Blob, name: string) => { writeFileSync(`${outDir}/${name}`, Buffer.from(await blob.arrayBuffer())); console.log('wrote', name); };

// Library packages (Library sidebar → Export library), as use-library-export.ts builds them.
for (const id of [ACTION_LIB, ENV_LIB]) {
  const library = libraries.find((l) => l.id === id)!;
  const tree: LibraryWithChildren = { library, specifications: byLib.get(id) ?? [], children: [] };
  const blob = await createLibraryPackage({ tree, entityType: library.entityType, images: {}, allSpecs: specs, allLibraries: libraries, allSpecsByLibrary: byLib });
  await save(blob, `${withVersionSuffix(library.name, library.version)}.${getLibraryPackageExtension(library.entityType)}`);
}

// Single Environment Package (.WFenvirX), as exportSingleEnvironment builds it (minus the browser download).
const env = byLib.get(ENV_LIB)!.find((s) => s.name === 'Distributed Workflow Management')!;
const actionLibName = libraries.find((l) => l.id === ACTION_LIB)!.name;
const refs = (env.data.included_actions ?? []) as Array<{ action_library?: string; action_name?: string }>;
const actions = refs.flatMap((r) => {
  if (r.action_library !== actionLibName) throw new Error(`unexpected action library ${r.action_library}`);
  const a = byLib.get(ACTION_LIB)!.find((s) => s.name === r.action_name);
  if (!a) throw new Error(`action ${r.action_name} not found`);
  return [specToMasterAction(a)];
});
console.log(`environment includes ${actions.length} actions`);
const envSpec = exportEnvironmentSpec(env, undefined, libraries, byLib);
await save(await exportEnvironmentPackage(envSpec, [{ libraryName: actionLibName, specs: actions }]), `${withVersionSuffix(env.name, env.version)}.WFenvirX`);
