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
//
// The canonical v1 schema shapes. @mission/form-schema is upstream of Designer, and since
// the v1 editor tree was retired these types are OWNED here — Designer consumes them from
// this package (see MissionDesigner/src/lib/form-document/convert-layouts.ts). There is no
// separate drift guard: this file is the contract, not a copy of one.

/** Value shapes carried by v1 content elements. All optional: `type` is a loose string here. */
export interface V1Element {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  zIndex?: number
  // content / data props
  content?: string
  fieldName?: string
  label?: string
  placeholder?: string
  required?: boolean
  options?: { label: string; value: string }[]
  outputValue?: string
  outputParameter?: string
  inputMode?: string
  listItems?: { label: string; value: string }[]
  listSource?: { mode: 'static' } | { mode: 'input'; value: string }
  defaultSource?: { mode: 'static' | 'property' | 'input'; value: string }
  placeholderSource?: { mode: 'static' | 'property' | 'input'; value: string }
  rows?: number
  src?: string
  imageOid?: string
  objectFit?: 'contain' | 'cover' | 'fill'
  posterUrl?: string
  durationSeconds?: number
  direction?: 'countdown' | 'countup'
  blockDone?: boolean
  deletable?: boolean
  fontSize?: number
  fontWeight?: 'normal' | 'bold'
  color?: string
  align?: 'left' | 'center' | 'right'
  thickness?: number
}

export interface V1FormLayout {
  canvasWidth: number
  canvasHeight: number
  elements: V1Element[]
}

export interface V1FormLayouts {
  phone: V1FormLayout
  tablet: V1FormLayout
  desktop: V1FormLayout
}
