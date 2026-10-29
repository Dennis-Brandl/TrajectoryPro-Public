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
import type { DividerBlock } from '@mission/form-schema'
import { useAuthoredColor } from './common'

export function DividerBlockView({ block }: { block: DividerBlock }) {
  const color = useAuthoredColor(block.color)
  return (
    <hr
      className={`tfk-hr${block.weight === 'thick' ? ' tfk-hr-thick' : ''}`}
      // Authored appearance colour, like text and button colour: data-driven, so no
      // class can express it. Not layout — see docs/CONVENTIONS.md.
      style={color ? { borderTopColor: color } : undefined}
    />
  )
}
