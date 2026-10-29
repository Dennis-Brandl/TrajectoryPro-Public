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

// Pure-data mappers between the editor's internal state shape and the
// Trajectory runtime package format (`MasterWorkflowSpecification`,
// `MasterWorkflowLibrary`, etc.). No DOM dependencies — usable from the
// editor backend (`src/server/`) and from Node-side tests.
//
// The runtime contract these emit against lives in the TrajectoryRuntime reference repository —
// see `spec/docs/editor-export-format.md` and `engines/web/src/loader.ts`.

export * from './export-types'
export * from './entity-converters'
export * from './parameter-extractors'
export * from './step-extractors'
export * from './image-collectors'
export * from './library-exporters'
export * from './workflow-exporters'
export * from './library-package'
