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

import { useIsChildWorkflow } from '@/hooks/useIsChildWorkflow'
import { DEFAULT_STROKE } from './colors'

/**
 * ISA88-specific chevron lines in the top-left corner of rect nodes.
 * Single chevron = top-level workflow, double chevron = child workflow.
 */
export function Chevrons() {
  const isChild = useIsChildWorkflow()
  return (
    <>
      <line x1="2" y1="12" x2="12" y2="2" stroke={DEFAULT_STROKE} strokeWidth="1" />
      {isChild && <line x1="2" y1="20" x2="20" y2="2" stroke={DEFAULT_STROKE} strokeWidth="1" />}
    </>
  )
}
