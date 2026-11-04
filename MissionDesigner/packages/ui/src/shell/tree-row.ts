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

import { cn } from '../lib/utils'

const DEPTH_PAD = { 0: 'pl-2', 1: 'pl-6', 2: 'pl-10' } as const

export function treeRowClass(o: { selected?: boolean; depth?: 0 | 1 | 2 } = {}): string {
  return cn(
    'flex h-6 items-center gap-1 text-xs hover:bg-muted pr-2',
    DEPTH_PAD[o.depth ?? 0],
    o.selected && 'bg-selection',
  )
}
