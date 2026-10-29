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

// Phase 35 cutover (§2.3): private re-export of tables that the read DAO
// inspects but no other layer should import directly.
//
// This file is import-restricted by `eslint-rules/no-sensitive-table-imports.js`
// (wired in Task D4). Importing from outside `src/server/dao/**` is a build
// failure.
//
// The leading underscore is a convention; the lint rule is the enforcement.

export {
  library,
  specification,
  imageBlob,
  image,
  imageReference,
  proxyReference,
  libraryEnvironment,
  specificationEnvironment,
} from './schema'
