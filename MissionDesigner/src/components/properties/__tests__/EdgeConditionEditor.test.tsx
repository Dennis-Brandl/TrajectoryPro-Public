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

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EdgeConditionEditor } from '../EdgeConditionEditor'
import type { StepNodeData } from '@/types/nodes'

const opt = (o: Record<string, unknown>) => ({
  id: 'h1',
  label: '',
  operator: '>',
  value: '',
  valueType: 'literal',
  isDefault: false,
  ...o,
})
const data = (options: unknown[], extra: Record<string, unknown> = {}) =>
  ({ label: 'S', select1InputName: 'temp', select1Options: options, ...extra }) as unknown as StepNodeData

const renderIt = (d: StepNodeData, handle: string | null = 'h1') =>
  render(<EdgeConditionEditor sourceNodeData={d} sourceHandleId={handle} sourceNodeLabel="Pick" />)

describe('EdgeConditionEditor', () => {
  it('shows the expression read-only with the option label', () => {
    renderIt(data([opt({ value: '10', label: 'Hot' })]))
    expect(screen.getByText('Condition')).toBeTruthy()
    expect(screen.getByText('temp > 10')).toBeTruthy()
    expect(screen.getByText('Option: Hot')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('Edit conditions on the SELECT 1 step.')).toBeTruthy()
  })

  it('notes a value property reference', () => {
    renderIt(data([opt({ value: 'lim', valueType: 'property' })]))
    expect(screen.getByText(/value property/i)).toBeTruthy()
  })

  it('shows default text', () => {
    renderIt(data([opt({ isDefault: true, label: 'Else' })]))
    expect(screen.getByText('Default — taken when no other option matches')).toBeTruthy()
    expect(screen.getByText('Option: Else')).toBeTruthy()
  })

  it('shows unconfigured text', () => {
    renderIt(data([opt({})]))
    expect(screen.getByText('Not configured yet — set the comparison value on the SELECT 1 step.')).toBeTruthy()
  })

  it('shows missing text', () => {
    renderIt(data([opt({})]), 'nope')
    expect(screen.getByText('This connection is not linked to a SELECT 1 option.')).toBeTruthy()
  })
})
