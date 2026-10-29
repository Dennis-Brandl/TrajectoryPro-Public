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

/** Design-token references (values defined in @mission/form-tokens). */
export type SpaceToken = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type TypeToken = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'

export type GridSpan = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

/**
 * Per-breakpoint value with desktop-base cascade (D2).
 * Resolution: phone ?? tablet ?? base. `base` is the desktop reference frame.
 */
export interface PerBreakpoint<T> {
  base: T
  tablet?: T
  phone?: T
}

/** Per-device type-size overrides. Desktop is the block's own `size`; resolution is phone ?? tablet ?? desktop. */
export interface SizeAt {
  tablet?: TypeToken
  phone?: TypeToken
}

/** What a button does for the step: advance, or answer a Yes/No step. */
export type ButtonJob = 'continue' | 'yes' | 'no'

/** Which Pilot answer buttons a step needs. */
export type StepKind = 'continue' | 'yesno'

export interface BlockLayout {
  /** Grid columns occupied (of 12). Default 12. */
  span?: PerBreakpoint<GridSpan>
  /** Reflow order override within the row. Default: DOM order. */
  order?: PerBreakpoint<number>
  /** Hide the block at a breakpoint. Default true. */
  visible?: PerBreakpoint<boolean>
  /** 'fixed-with-min' escape for height only. */
  minHeight?: SpaceToken | { rem: number }
  /** Readable-measure / media caps. */
  maxWidth?: { ch: number } | { rem: number }
  /** 'W/H' e.g. '16/9'. Required for image blocks; default '16/9' for video. */
  aspectRatio?: string
  /** Block alignment inside its grid cell. Default 'start'. */
  align?: 'start' | 'center' | 'end'
}

/** Source of a default value: fixed literal, Value Property reference, or input parameter. */
export type ParameterDefaultSource =
  | { mode: 'static'; value: string }
  | { mode: 'property'; value: string }
  | { mode: 'input'; value: string }

export interface OptionEntry {
  label: string
  value: string
}

export type ListItemSource = { mode: 'static' } | { mode: 'input'; value: string }

export type TextInputMode = 'text' | 'number' | 'phone' | 'password' | 'dropdown' | 'combobox'

interface BlockBase {
  /** Stable snowflake OID. Exported as-is (v2 never strips ids). */
  id: string
  layout?: BlockLayout
}

export interface TextBlock extends BlockBase {
  type: 'text'
  content: string
  size?: TypeToken
  sizeAt?: SizeAt
  fontWeight?: 'normal' | 'bold'
  color?: string
  align?: 'left' | 'center' | 'right'
}

export interface HeaderBlock extends BlockBase {
  type: 'header'
  content: string
  size?: TypeToken
  sizeAt?: SizeAt
  fontWeight?: 'normal' | 'bold'
  color?: string
  align?: 'left' | 'center' | 'right'
}

export interface TextInputBlock extends BlockBase {
  type: 'textInput'
  fieldName: string
  label?: string
  placeholder?: string
  required?: boolean
  inputMode?: TextInputMode
  listItems?: OptionEntry[]
  listSource?: ListItemSource
  outputParameter?: string
  defaultSource?: ParameterDefaultSource
  placeholderSource?: ParameterDefaultSource
  size?: TypeToken
  sizeAt?: SizeAt
}

export interface TextareaBlock extends BlockBase {
  type: 'textarea'
  fieldName: string
  label?: string
  placeholder?: string
  required?: boolean
  rows?: number
  outputParameter?: string
  defaultSource?: ParameterDefaultSource
  placeholderSource?: ParameterDefaultSource
  size?: TypeToken
  sizeAt?: SizeAt
}

export interface CheckboxBlock extends BlockBase {
  type: 'checkbox'
  fieldName: string
  options: OptionEntry[]
  label?: string
  required?: boolean
  listSource?: ListItemSource
  outputParameter?: string
  size?: TypeToken
  sizeAt?: SizeAt
}

export interface RadioBlock extends BlockBase {
  type: 'radio'
  fieldName: string
  options: OptionEntry[]
  label?: string
  required?: boolean
  listSource?: ListItemSource
  outputParameter?: string
  size?: TypeToken
  sizeAt?: SizeAt
}

export interface ImageBlock extends BlockBase {
  type: 'image'
  src: string
  imageOid?: string
  objectFit?: 'contain' | 'cover' | 'fill'
  /** Media-box width as a percentage of the block's grid cell (10–300). Default 100. */
  scalePercent?: number
  /** Image blocks REQUIRE layout.aspectRatio (enforced by the JSON Schema). */
  layout?: BlockLayout
}

export interface VideoBlock extends BlockBase {
  type: 'video'
  src: string
  posterUrl?: string
}

export interface DividerBlock extends BlockBase {
  type: 'divider'
  weight?: 'hairline' | 'thick'
  color?: string
}

export interface TimerBlock extends BlockBase {
  type: 'timer'
  label: string
  fieldName: string
  durationSeconds: number
  direction: 'countdown' | 'countup'
  blockDone?: boolean
  outputParameter?: string
  defaultSource?: ParameterDefaultSource
  size?: TypeToken
  sizeAt?: SizeAt
}

export interface ButtonBlock extends BlockBase {
  type: 'button'
  label: string
  outputValue: string
  color?: string
  emphasis?: 'primary' | 'secondary'
  deletable?: boolean
  /** Gives the button a job; job-less buttons keep the plain `action` behaviour. */
  job?: ButtonJob
  size?: TypeToken
  sizeAt?: SizeAt
}

/** Electronic signature (spec 2026-09-06). The host owns the credential draft; it never enters `values`. */
export interface ESignatureBlock extends BlockBase {
  type: 'esignature'
  fieldName: string
  /** Heading, e.g. "Approve timesheet". Default "E-signature". */
  label?: string
  /** Statement the signer attests to, e.g. "I approve this timesheet as submitted". */
  meaning?: string
  /** Name of a role defined in Mission Commander that the signer must hold in this work center. Absent/empty = any member. */
  roleName?: string
  /** The signer must not be the Pilot operator who holds the claim. Default false. */
  requireDifferentUser?: boolean
  /** Receives the signer's display name, written by the server after verification. */
  outputParameter?: string
}

export type Block =
  | TextBlock
  | HeaderBlock
  | TextInputBlock
  | TextareaBlock
  | CheckboxBlock
  | RadioBlock
  | ImageBlock
  | VideoBlock
  | DividerBlock
  | TimerBlock
  | ButtonBlock
  | ESignatureBlock

export type BlockType = Block['type']

export interface Row {
  id: string
  gap?: SpaceToken
  blocks: Block[]
}

export interface Section {
  id: string
  role: 'content' | 'footer'
  rows: Row[]
}

export interface FormDocument {
  version: 2
  sections: Section[]
}
