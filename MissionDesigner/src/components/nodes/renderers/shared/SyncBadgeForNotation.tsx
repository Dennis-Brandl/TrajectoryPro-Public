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

import type { Notation } from '@/types/notation'
import { FlowchartSyncBadge, BpmnSyncBadge, Isa88SyncBadge } from '@/components/nodes/SyncBadge'

type SyncAction = 'Send' | 'Receive' | 'Synchronize'

interface Props {
  notation: Notation
  action: SyncAction
}

/**
 * Renders the notation-appropriate SyncBadge component.
 */
export function SyncBadgeForNotation({ notation, action }: Props) {
  switch (notation) {
    case 'flowchart':
      return <FlowchartSyncBadge action={action} />
    case 'bpmn':
      return <BpmnSyncBadge action={action} />
    case 'isa88':
      return <Isa88SyncBadge action={action} />
  }
}
