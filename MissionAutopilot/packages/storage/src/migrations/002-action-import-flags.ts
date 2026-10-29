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

import type { Migration } from './runner.js'

/**
 * Import flags on actions:
 *   - signature_change: JSON text set by an environment re-import when the
 *     action already has code and its input/output signature differs from the
 *     one that code was written against (cleared by the author).
 *   - orphaned_at: ISO timestamp set when the last import of the parent
 *     environment no longer contained this action but it still has code
 *     (an action with no code is deleted outright instead).
 */
export const migration: Migration = {
  name: '002-action-import-flags',

  async up(q) {
    await q.query(`ALTER TABLE actions ADD COLUMN signature_change text DEFAULT NULL`)
    await q.query(`ALTER TABLE actions ADD COLUMN orphaned_at text DEFAULT NULL`)
  },
}
