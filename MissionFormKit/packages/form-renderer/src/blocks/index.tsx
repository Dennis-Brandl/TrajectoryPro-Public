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
import type { ReactNode } from 'react'
import type { Block } from '@mission/form-schema'
import { TextBlockView } from './TextBlockView'
import { HeaderBlockView } from './HeaderBlockView'
import { TextInputBlockView } from './TextInputBlockView'
import { TextareaBlockView } from './TextareaBlockView'
import { CheckboxBlockView } from './CheckboxBlockView'
import { RadioBlockView } from './RadioBlockView'
import { ImageBlockView } from './ImageBlockView'
import { VideoBlockView } from './VideoBlockView'
import { DividerBlockView } from './DividerBlockView'
import { TimerBlockView } from './TimerBlockView'
import { ButtonBlockView } from './ButtonBlockView'
import { ESignatureBlockView } from './ESignatureBlockView'

function assertNever(value: never): never {
  throw new Error(`Unhandled block type: ${JSON.stringify(value)}`)
}

/** Exhaustive block dispatch — a new Block variant fails compilation here. */
export function renderBlock(block: Block, onTimerSettle?: (fieldName: string) => void): ReactNode {
  switch (block.type) {
    case 'text':
      return <TextBlockView block={block} />
    case 'header':
      return <HeaderBlockView block={block} />
    case 'textInput':
      return <TextInputBlockView block={block} />
    case 'textarea':
      return <TextareaBlockView block={block} />
    case 'checkbox':
      return <CheckboxBlockView block={block} />
    case 'radio':
      return <RadioBlockView block={block} />
    case 'image':
      return <ImageBlockView block={block} />
    case 'video':
      return <VideoBlockView block={block} />
    case 'divider':
      return <DividerBlockView block={block} />
    case 'timer':
      return <TimerBlockView block={block} onSettle={onTimerSettle} />
    case 'button':
      return <ButtonBlockView block={block} />
    case 'esignature':
      return <ESignatureBlockView block={block} />
    default:
      return assertNever(block)
  }
}
