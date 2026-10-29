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

/**
 * Appends an entity's version to an export file base name in parentheses:
 * `Kitchen` + `1.0.1` → `Kitchen(1.0.1)`. Every user-facing export download
 * (packages, JSON, PDF, images) routes its base name through here so exported
 * files carry the version they were cut from. Returns the name unchanged when
 * no version is available (e.g. libraries without a version).
 */
export function withVersionSuffix(name: string, version: string | null | undefined): string {
  const v = version?.trim()
  return v ? `${name}(${v})` : name
}

/** A library PDF is named for the library: `Distributed Workflow Action Library(1.0.0).pdf`. */
export function libraryPdfFilename(library: { name: string; version?: string | null }): string {
  return `${withVersionSuffix(library.name, library.version)}.pdf`
}
