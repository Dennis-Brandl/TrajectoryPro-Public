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
// Mirrors mission-control-db's ACCESS_LEVELS (dao/access.ts). The VALUE stays renderer-local
// so the server package is never imported into the browser bundle; the type-only guard below
// turns any drift from the package's union into a compile error (audit item 2).
export const ACCESS_LEVELS = ['administrator', 'steward', 'viewer'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

import type { AccessLevel as DbAccessLevel } from 'mission-control-db';
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
export type _AccessLevelGuard = Expect<Equals<AccessLevel, DbAccessLevel>>;
