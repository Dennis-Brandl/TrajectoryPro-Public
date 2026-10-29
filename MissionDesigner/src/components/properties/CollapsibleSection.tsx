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

import * as Accordion from '@radix-ui/react-accordion'
import { ChevronDown } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

// Styling mirrors the (retired v1) form designer's inspector accordion sections
// so the workflow canvas panel matches the UI canvas panel exactly.
const triggerStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 600,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  userSelect: 'none',
}

const contentStyle: CSSProperties = {
  padding: '4px 12px 12px',
}

interface CollapsibleSectionProps {
  /** Unique accordion item id within its Accordion.Root */
  value: string
  /** Title shown in the trigger (e.g. "Input Parameters") */
  title: string
  /** Number of elements in the section, shown after the title as "(n)" when given */
  count?: number
  children: ReactNode
}

/**
 * One collapsible property section. MUST be rendered inside an
 * <Accordion.Root type="multiple">. The trigger supplies the section title,
 * so child editors should be rendered with their own heading suppressed.
 */
export function CollapsibleSection({ value, title, count, children }: CollapsibleSectionProps) {
  return (
    <Accordion.Item value={value} className="border-b border-slate-200 dark:border-slate-700">
      <Accordion.Header>
        <Accordion.Trigger className="text-gray-700 dark:text-slate-200" style={triggerStyle}>
          {/* The title keeps its own element so text queries on the bare title still match
              when a count is appended (e.g. "INPUT PARAMETERS (3)"). */}
          <span>
            <span>{title}</span>
            {/* inline-block so the count reads as its own word in the accessible name
                ("Input Parameters (3)"), not glued to the title. */}
            {count !== undefined && <span style={{ display: 'inline-block', marginLeft: '0.35em' }}>({count})</span>}
          </span>
          <ChevronDown size={14} />
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content style={contentStyle}>{children}</Accordion.Content>
    </Accordion.Item>
  )
}
