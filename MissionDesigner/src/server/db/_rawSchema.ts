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

// Phase 35 cutover (§2.3): private re-export of the full drizzle schema as
// a single object. Used by the read DAO for complex queries that span
// multiple tables.
//
// This file is import-restricted by `eslint-rules/no-sensitive-table-imports.js`.
// Importing from outside `src/server/dao/**` is a build failure.

import * as schema from './schema'
export { schema as rawSchema }
