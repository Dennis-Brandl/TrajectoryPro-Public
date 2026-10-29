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

import { DaoError } from './errors.js';

export const MAX_NAME_LENGTH = 200;

// Names back a unique btree index; an unbounded value overflows the index row (SQLSTATE
// 54000 → a logged 500). Reject over-long names as a clean domain error before the insert.
export function assertNameLength(name: string): void {
  if (name.length > MAX_NAME_LENGTH) {
    throw new DaoError('NAME_TOO_LONG', `Name exceeds ${MAX_NAME_LENGTH} characters`);
  }
}
